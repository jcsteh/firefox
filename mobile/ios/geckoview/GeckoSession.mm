/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#import "GeckoSession.h"
#include "nsIAppWindow.h"
#include "nsIWidgetListener.h"
#include "nsIWebNavigation.h"
#include "nsDocShellLoadState.h"
#include "nsIDocShellTreeOwner.h"
#include "nsObjCExceptions.h"

#include "mozilla/dom/CanonicalBrowsingContext.h"
#include "mozilla/Preferences.h"
#include "nsServiceManagerUtils.h"
#include "nsWindowWatcher.h"
#include "nsPIDOMWindow.h"
#include "nsWindow.h"

// Internal state object to avoid including c++ in the header.
@interface GeckoSessionState : NSObject {
 @public
  RefPtr<nsWindow> mWindow;
  nsCOMPtr<nsPIDOMWindowOuter> mOuterWindow;
}
@end

@implementation GeckoSessionState
@end

static already_AddRefed<mozilla::dom::CanonicalBrowsingContext>
GetPrimaryContentBrowsingContext(GeckoSessionState* aSession) {
  nsCOMPtr<nsIDocShellTreeOwner> dsti = aSession->mOuterWindow->GetTreeOwner();
  RefPtr<mozilla::dom::BrowsingContext> bc;
  nsresult rv = dsti->GetPrimaryContentBrowsingContext(getter_AddRefs(bc));
  NS_ENSURE_SUCCESS(rv, nullptr);
  return do_AddRef(mozilla::dom::CanonicalBrowsingContext::Cast(bc));
}

@implementation GeckoSession

- (id)init {
  mState = [[GeckoSessionState alloc] init];
  return self;
}

- (void)open {
  NSUUID* uuid = [NSUUID UUID];
  NSString* str = [uuid UUIDString];
  [self openWithId:[str stringByReplacingOccurrencesOfString:@"-"
                                                  withString:@""]];
}

- (void)openWithId:(NSString*)aId {
  nsAutoCString url;
  nsresult rv =
      mozilla::Preferences::GetCString("toolkit.defaultChromeURI", url);
  if (NS_FAILED(rv)) {
    url = "chrome://geckoview/content/geckoview.xhtml"_ns;
  }

  nsDependentCString id([aId UTF8String],
                        [aId lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);

  nsCOMPtr<nsIWindowWatcher> ww = do_GetService(NS_WINDOWWATCHER_CONTRACTID);
  MOZ_RELEASE_ASSERT(ww);

  nsAutoCString chromeFlags("chrome,dialog=0,remote,resizable,scrollbars");
  // if (aPrivateMode) {
  //   chromeFlags += ",private";
  // }
  nsCOMPtr<mozIDOMWindowProxy> domWindow;
  ww->OpenWindow(nullptr, url, id, chromeFlags, nullptr,
                 getter_AddRefs(domWindow));
  MOZ_RELEASE_ASSERT(domWindow);

  mState->mOuterWindow = nsPIDOMWindowOuter::From(domWindow);
  mState->mWindow = nsWindow::From(mState->mOuterWindow);
  MOZ_RELEASE_ASSERT(mState->mWindow);

  if (nsIWidgetListener* widgetListener =
          mState->mWindow->GetWidgetListener()) {
    if (nsIAppWindow* appWindow = widgetListener->GetAppWindow()) {
      // The size of this window is forced by our embedder, so tell AppWindow
      // to not set a size for us.
      appWindow->SetIntrinsicallySized(false);
    }
  }
}

- (UIView*)view {
  return (UIView*)mState->mWindow->GetNativeData(NS_NATIVE_WIDGET);
}

- (void)loadURL:(NSURL*)aURL {
  RefPtr<mozilla::dom::CanonicalBrowsingContext> bc =
      GetPrimaryContentBrowsingContext(mState);
  NS_ENSURE_TRUE_VOID(bc);

  const char* const urlString = [[aURL absoluteString] UTF8String];
  nsCOMPtr<nsIURI> uri;
  nsresult rv = NS_NewURI(getter_AddRefs(uri), urlString);
  NS_ENSURE_SUCCESS_VOID(rv);

  RefPtr<nsDocShellLoadState> loadState = new nsDocShellLoadState(uri);
  loadState->SetTriggeringPrincipal(nsContentUtils::GetSystemPrincipal());

  rv = bc->LoadURI(loadState);
  NS_ENSURE_SUCCESS_VOID(rv);
}

- (void)reload {
  RefPtr<mozilla::dom::CanonicalBrowsingContext> bc =
      GetPrimaryContentBrowsingContext(mState);
  NS_ENSURE_TRUE_VOID(bc);

  bc->Reload(nsIWebNavigation::LOAD_FLAGS_NONE);
}

- (void)stop {
  RefPtr<mozilla::dom::CanonicalBrowsingContext> bc =
      GetPrimaryContentBrowsingContext(mState);
  NS_ENSURE_TRUE_VOID(bc);

  bc->Stop(nsIWebNavigation::STOP_ALL);
}

- (void)goBack {
  RefPtr<mozilla::dom::CanonicalBrowsingContext> bc =
      GetPrimaryContentBrowsingContext(mState);
  NS_ENSURE_TRUE_VOID(bc);

  // FIXME: This doesn't support things like cancelling content js execution
  bc->GoBack({}, false, true);
}

- (void)goForward {
  RefPtr<mozilla::dom::CanonicalBrowsingContext> bc =
      GetPrimaryContentBrowsingContext(mState);
  NS_ENSURE_TRUE_VOID(bc);

  // FIXME: This doesn't support things like cancelling content js execution
  bc->GoForward({}, false, true);
}

@end