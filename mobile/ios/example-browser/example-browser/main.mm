//
//  main.m
//  example-browser
//
//  Created by Nika Layzell on 2023-06-09.
//

#import <UIKit/UIKit.h>
#import "AppDelegate.h"

#define XPCOM_GLUE

#include "mozilla/Bootstrap.h"
#include "application.ini.h"
#include "ipc/contentproc/plugin-container.cpp"

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

int main(int argc, char * argv[]) {
    char exeDir[MAXPATHLEN];
    NSString* bundlePath = [[NSBundle mainBundle] bundlePath];
    strncpy(exeDir, [bundlePath UTF8String], MAXPATHLEN);
    strcat(exeDir, "/Frameworks/");
    strncat(exeDir, "XUL", MAXPATHLEN - strlen(exeDir));

    auto bootstrap = mozilla::GetBootstrap(exeDir);

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
    config.appDataPath = nullptr;

    bootstrap.inspect()->XRE_EnableSameExecutableForContentProc();
    bootstrap.inspect()->XRE_main(argc, argv, config);
}
