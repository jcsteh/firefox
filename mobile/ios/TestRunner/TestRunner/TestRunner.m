/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#import <UIKit/UIKit.h>
#import "GeckoRuntime.h"
#import "GeckoSession.h"

// RootViewController for the primary TestRunnerSceneDelegate.
// Creates and displays a single GeckoSession.
@interface TestRunnerRootViewController : UIViewController {
  GeckoSession* mSession;
}
@end

@implementation TestRunnerRootViewController

- (id)init {
  self = [super initWithNibName:nil bundle:nil];
  return self;
}

- (void)viewDidLoad {
  [super viewDidLoad];

  // Use the system background color so things like the status bar are visible.
  [self.view setBackgroundColor:UIColor.systemBackgroundColor];

  // Open a gecko session.
  mSession = [[GeckoSession alloc] init];
  [mSession open];

  // Attach the session to the view.
  UIView* browserView = [mSession view];
  [self.view addSubview:browserView];

  // Apply layout constraints such that the browser view fills the safe area.
  [browserView setTranslatesAutoresizingMaskIntoConstraints:NO];
  [[browserView.topAnchor
      constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor]
      setActive:YES];
  [[browserView.bottomAnchor
      constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor]
      setActive:YES];
  [[browserView.leadingAnchor
      constraintEqualToAnchor:self.view.safeAreaLayoutGuide.leadingAnchor]
      setActive:YES];
  [[browserView.trailingAnchor
      constraintEqualToAnchor:self.view.safeAreaLayoutGuide.trailingAnchor]
      setActive:YES];
}

@end

// Scene delegate for the primary scene, as specified in Info.plist.in.
// This will be created by UIKit after the application is started.
@interface TestRunnerSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(strong, nonatomic) UIWindow* window;
@end

@implementation TestRunnerSceneDelegate

- (void)scene:(UIScene*)scene
    willConnectToSession:(UISceneSession*)session
                 options:(UISceneConnectionOptions*)connectionOptions {
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }
  UIWindowScene* windowScene = (UIWindowScene*)scene;

  TestRunnerRootViewController* controller =
      [[TestRunnerRootViewController alloc] init];

  self.window = [[UIWindow alloc] initWithWindowScene:windowScene];
  self.window.rootViewController = controller;
  [self.window makeKeyAndVisible];
}

@end

int main(int argc, char* argv[]) {
  // FIXME: For now GeckoRuntime ignores the provided application delegate and
  // uses its own - we probably need to change that in the future.
  [GeckoRuntime mainWithArgc:argc
                        argv:argv
          principalClassName:nil
           delegateClassName:nil];
}

