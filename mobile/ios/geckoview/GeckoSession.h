/* -*- Mode: Objective-C; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class GeckoSessionState;

__attribute__((visibility("default")))
@interface GeckoSession : NSObject {
  GeckoSessionState* mState;
}

- (id)init;

- (void)open;
- (void)openWithId:(NSString*)id;

- (UIView*)view;

- (void)loadURL:(NSURL*)aURL;

- (void)reload;
- (void)stop;

- (void)goBack;
- (void)goForward;

@end
