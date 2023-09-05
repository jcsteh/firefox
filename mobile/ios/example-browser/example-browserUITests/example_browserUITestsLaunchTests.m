/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#import <XCTest/XCTest.h>

@interface example_browserUITestsLaunchTests : XCTestCase

@end

@implementation example_browserUITestsLaunchTests

+ (BOOL)runsForEachTargetApplicationUIConfiguration {
  return YES;
}

- (void)setUp {
  self.continueAfterFailure = NO;
}

- (void)testLaunch {
  XCUIApplication* app = [[XCUIApplication alloc] init];
  [app launch];

  // Insert steps here to perform after app launch but before taking a
  // screenshot, such as logging into a test account or navigating somewhere in
  // the app

  XCTAttachment* attachment =
      [XCTAttachment attachmentWithScreenshot:XCUIScreen.mainScreen.screenshot];
  attachment.name = @"Launch Screen";
  attachment.lifetime = XCTAttachmentLifetimeKeepAlways;
  [self addAttachment:attachment];
}

@end
