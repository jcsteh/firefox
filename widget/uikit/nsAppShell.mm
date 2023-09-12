/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#import <UIKit/UIApplication.h>
#import <UIKit/UIScreen.h>
#import <UIKit/UIWindow.h>
#import <UIKit/UIViewController.h>

#include "mozilla/AvailableMemoryWatcher.h"
#include "gfxPlatform.h"
#include "nsAppShell.h"
#include "nsCOMPtr.h"
#include "nsDirectoryServiceDefs.h"
#include "nsObjCExceptions.h"
#include "nsString.h"
#include "nsIRollupListener.h"
#include "nsIWidget.h"
#include "nsThreadUtils.h"
#include "nsMemoryPressure.h"
#include "nsServiceManagerUtils.h"
#include "mozilla/widget/ScreenManager.h"
#include "ScreenHelperUIKit.h"
#include "mozilla/Hal.h"
#include "HeadlessScreenHelper.h"
#include "nsWindow.h"

using namespace mozilla;
using namespace mozilla::widget;

nsAppShell* nsAppShell::gAppShell = NULL;
UIViewController* nsAppShell::gRootViewController = nil;
StaticRefPtr<nsWindow> nsAppShell::gRootWindow;

#define ALOG(args...)    \
  fprintf(stderr, args); \
  fprintf(stderr, "\n")

// ViewController
@interface ViewController : UIViewController
@end

@implementation ViewController

- (void)loadView {
  nsAppShell::gRootViewController = self;
  ALOG("[ViewController loadView]");
  CGRect r = {{0, 0}, {100, 100}};
  self.view = [[UIView alloc] initWithFrame:r];
  [self.view setBackgroundColor:UIColor.systemBackgroundColor];

  // If the root window was already created, add it to our view.
  if (nsAppShell::gRootWindow) {
    [self.view addSubview:(UIView*)nsAppShell::gRootWindow->GetNativeData(NS_NATIVE_WIDGET)];
  }
}

- (void)viewWillLayoutSubviews {
  // FIXME: This will forcibly resize `gRootWindow` to fill `applicationFrame`,
  // and is temporary. We should remove this and use UIKit layout or similar
  // once we get a proper embedding story.
  auto appFrame = self.view.window.screen.applicationFrame;
  if (nsAppShell::gRootWindow) {
    auto scaleFactor = nsAppShell::gRootWindow->BackingScaleFactor();
    nsAppShell::gRootWindow->Resize(
        appFrame.origin.x * scaleFactor, appFrame.origin.y * scaleFactor,
        appFrame.size.width * scaleFactor, appFrame.size.height * scaleFactor, false);
  }
}
@end

// AppShellDelegate
//
// Acts as a delegate for the UIApplication

@interface AppShellDelegate : NSObject <UIApplicationDelegate> {
}
@property(strong, nonatomic) UIWindow* window;
@end

@implementation AppShellDelegate

- (BOOL)application:(UIApplication*)application
    didFinishLaunchingWithOptions:(NSDictionary*)launchOptions {
  ALOG("[AppShellDelegate application:didFinishLaunchingWithOptions:]");

  return YES;
}

- (void)applicationWillTerminate:(UIApplication*)application {
  ALOG("[AppShellDelegate applicationWillTerminate:]");
  nsAppShell::gAppShell->WillTerminate();
}

- (void)applicationDidBecomeActive:(UIApplication*)application {
  ALOG("[AppShellDelegate applicationDidBecomeActive:]");
}

- (void)applicationWillResignActive:(UIApplication*)application {
  ALOG("[AppShellDelegate applicationWillResignActive:]");
}

- (void)applicationDidReceiveMemoryWarning:(UIApplication*)application {
  ALOG("[AppShellDelegate applicationDidReceiveMemoryWarning:]");
  NS_NotifyOfMemoryPressure(MemoryPressureState::LowMemory);
}
@end

// nsAppShell implementation

NS_IMETHODIMP
nsAppShell::ResumeNative(void) { return nsBaseAppShell::ResumeNative(); }

nsAppShell::nsAppShell()
    : mAutoreleasePool(NULL),
      mDelegate(NULL),
      mCFRunLoop(NULL),
      mCFRunLoopSource(NULL),
      mRunningEventLoop(false),
      mTerminated(false),
      mNotifiedWillTerminate(false) {
  gAppShell = this;
}

nsAppShell::~nsAppShell() {
  if (mAutoreleasePool) {
    [mAutoreleasePool release];
    mAutoreleasePool = NULL;
  }

  if (mCFRunLoop) {
    if (mCFRunLoopSource) {
      ::CFRunLoopRemoveSource(mCFRunLoop, mCFRunLoopSource,
                              kCFRunLoopCommonModes);
      ::CFRelease(mCFRunLoopSource);
    }
    ::CFRelease(mCFRunLoop);
  }

  gAppShell = NULL;
}

// Init
//
// public
nsresult nsAppShell::Init() {
  mAutoreleasePool = [[NSAutoreleasePool alloc] init];

  // Add a CFRunLoopSource to the main native run loop.  The source is
  // responsible for interrupting the run loop when Gecko events are ready.

  mCFRunLoop = [[NSRunLoop currentRunLoop] getCFRunLoop];
  NS_ENSURE_STATE(mCFRunLoop);
  ::CFRetain(mCFRunLoop);

  CFRunLoopSourceContext context;
  bzero(&context, sizeof(context));
  // context.version = 0;
  context.info = this;
  context.perform = ProcessGeckoEvents;

  mCFRunLoopSource = ::CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context);
  NS_ENSURE_STATE(mCFRunLoopSource);

  ::CFRunLoopAddSource(mCFRunLoop, mCFRunLoopSource, kCFRunLoopCommonModes);

  hal::Init();

  if (XRE_IsParentProcess()) {
    ScreenManager& screenManager = ScreenManager::GetSingleton();

    if (gfxPlatform::IsHeadless()) {
      screenManager.SetHelper(mozilla::MakeUnique<HeadlessScreenHelper>());
    } else {
      screenManager.SetHelper(mozilla::MakeUnique<ScreenHelperUIKit>());
    }

    InitMemoryPressureObserver();
  }

  return nsBaseAppShell::Init();
}

void nsAppShell::InitMemoryPressureObserver() {
  // Testing shows that sometimes the memory pressure event is not fired for
  // over a minute after the memory pressure change is reflected in sysctl
  // values. Hence this may need to be augmented with polling of the memory
  // pressure sysctls for lower latency reactions to OS memory pressure. This
  // was also observed when using DISPATCH_QUEUE_PRIORITY_HIGH.
  mMemoryPressureSource = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
      DISPATCH_MEMORYPRESSURE_NORMAL | DISPATCH_MEMORYPRESSURE_WARN |
          DISPATCH_MEMORYPRESSURE_CRITICAL,
      dispatch_get_main_queue());

  dispatch_source_set_event_handler(mMemoryPressureSource, ^{
    dispatch_source_memorypressure_flags_t pressureLevel =
        dispatch_source_get_data(mMemoryPressureSource);
    nsAppShell::OnMemoryPressureChanged(pressureLevel);
  });

  dispatch_resume(mMemoryPressureSource);

  // Initialize the memory watcher.
  RefPtr<mozilla::nsAvailableMemoryWatcherBase> watcher(
      nsAvailableMemoryWatcherBase::GetSingleton());
}

void nsAppShell::OnMemoryPressureChanged(
    dispatch_source_memorypressure_flags_t aPressureLevel) {
  // The memory pressure dispatch source is created (above) with
  // dispatch_get_main_queue() which always fires on the main thread.
  MOZ_ASSERT(NS_IsMainThread());

  MacMemoryPressureLevel geckoPressureLevel;
  switch (aPressureLevel) {
    case DISPATCH_MEMORYPRESSURE_NORMAL:
      geckoPressureLevel = MacMemoryPressureLevel::Value::eNormal;
      break;
    case DISPATCH_MEMORYPRESSURE_WARN:
      geckoPressureLevel = MacMemoryPressureLevel::Value::eWarning;
      break;
    case DISPATCH_MEMORYPRESSURE_CRITICAL:
      geckoPressureLevel = MacMemoryPressureLevel::Value::eCritical;
      break;
    default:
      geckoPressureLevel = MacMemoryPressureLevel::Value::eUnexpected;
  }

  RefPtr<mozilla::nsAvailableMemoryWatcherBase> watcher(
      nsAvailableMemoryWatcherBase::GetSingleton());
  watcher->OnMemoryPressureChanged(geckoPressureLevel);
}

// ProcessGeckoEvents
//
// The "perform" target of mCFRunLoop, called when mCFRunLoopSource is
// signalled from ScheduleNativeEventCallback.
//
// protected static
void nsAppShell::ProcessGeckoEvents(void* aInfo) {
  nsAppShell* self = static_cast<nsAppShell*>(aInfo);
  if (self->mRunningEventLoop) {
    self->mRunningEventLoop = false;
  }
  self->NativeEventCallback();
  self->Release();
}

// WillTerminate
//
// public
void nsAppShell::WillTerminate() {
  mNotifiedWillTerminate = true;
  if (mTerminated) return;
  mTerminated = true;
  // We won't get another chance to process events
  NS_ProcessPendingEvents(NS_GetCurrentThread());

  // Unless we call nsBaseAppShell::Exit() here, it might not get called
  // at all.
  nsBaseAppShell::Exit();
}

// ScheduleNativeEventCallback
//
// protected virtual
void nsAppShell::ScheduleNativeEventCallback() {
  if (mTerminated) return;

  NS_ADDREF_THIS();

  // This will invoke ProcessGeckoEvents on the main thread.
  ::CFRunLoopSourceSignal(mCFRunLoopSource);
  ::CFRunLoopWakeUp(mCFRunLoop);
}

// ProcessNextNativeEvent
//
// protected virtual
bool nsAppShell::ProcessNextNativeEvent(bool aMayWait) {
  NS_OBJC_BEGIN_TRY_IGNORE_BLOCK;

  if (mTerminated) return false;

  bool wasRunningEventLoop = mRunningEventLoop;
  mRunningEventLoop = aMayWait;
  NSString* currentMode = nil;
  NSDate* waitUntil = nil;
  if (aMayWait) waitUntil = [NSDate distantFuture];
  NSRunLoop* currentRunLoop = [NSRunLoop currentRunLoop];

  do {
    currentMode = [currentRunLoop currentMode];
    if (!currentMode) currentMode = NSDefaultRunLoopMode;

    if (aMayWait) {
      [currentRunLoop runMode:currentMode beforeDate:waitUntil];
    } else {
      [currentRunLoop acceptInputForMode:currentMode beforeDate:waitUntil];
    }
  } while (mRunningEventLoop);

  mRunningEventLoop = wasRunningEventLoop;

  NS_OBJC_END_TRY_IGNORE_BLOCK;

  return false;
}

// Run
//
// public
NS_IMETHODIMP
nsAppShell::Run(void) {
  ALOG("nsAppShell::Run");

  nsresult rv = NS_OK;
  if (XRE_UseNativeEventProcessing()) {
    char argv[1][4] = {"app"};
    UIApplicationMain(1, (char**)argv, nil, @"AppShellDelegate");
    // UIApplicationMain doesn't exit. :-(
  } else {
    rv = nsBaseAppShell::Run();
  }

  return rv;
}

NS_IMETHODIMP
nsAppShell::Exit(void) {
  if (mTerminated) return NS_OK;

  mTerminated = true;
  return nsBaseAppShell::Exit();
}
