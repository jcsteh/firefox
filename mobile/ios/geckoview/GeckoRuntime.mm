/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#import "GeckoRuntime.h"

#include "mozilla/Bootstrap.h"
#include "application.ini.h"

// NOTE: This is a temporary way to support content processes on the iOS
// simulator - I expect that we'll need an alternative approach on real
// devices.
#include "../../../ipc/contentproc/plugin-container.cpp"

/**
 * Return true if |arg| matches the given argument name.
 */
static bool IsArg(const char* arg, const char* s) {
  if (*arg == '-') {
    if (*++arg == '-') ++arg;
    return !strcasecmp(arg, s);
  }
  return false;
}

@implementation GeckoRuntime

+ (int)mainWithArgc:(int)argc
                  argv:(char**)argv
    principalClassName:(NSString*)principalClassName
     delegateClassName:(NSString*)delegateClassName {
  auto bootstrap = mozilla::GetBootstrap();
  if (bootstrap.isErr()) {
    fprintf(stderr, "Couldn't load XPCOM.\n");
    return 255;
  }

  // We are launching as a content process, delegate to the appropriate
  // main
  if (argc > 1 && IsArg(argv[1], "contentproc")) {
    // Set the process type. We don't remove the arg here as that will be done
    // later in common code.
    mozilla::SetGeckoProcessType(argv[argc - 1]);

    return content_process_main(bootstrap.inspect().get(), argc, argv);
  }

  mozilla::BootstrapConfig config;
  config.appData = &sAppData;
  config.appDataPath = "browser";

  bootstrap.inspect()->XRE_EnableSameExecutableForContentProc();
  return bootstrap.inspect()->XRE_main(argc, argv, config);
}

@end