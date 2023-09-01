#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/. */

set -e

if test "${ACTION}" != "clean"; then
    echo "Building in ${GECKO_OBJDIR}"
    make -j8 -s -C $GECKO_OBJDIR binaries

    echo "Copying files from ${GECKO_OBJDIR}/dist/bin"
    echo "Copying files to $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks"
    rsync -pvtrlL --exclude "Test*" \
          --exclude "test_*" --exclude "*_unittest" \
          --exclude xulrunner  \
          ${GECKO_OBJDIR}/dist/bin/ $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks

    echo "${__IS_NOT_SIMULATOR}"
    if test "${__IS_NOT_SIMULATOR}" = "YES"; then
        for x in $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks/*.dylib $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks/XUL; do
            echo "Signing $x"
            /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements,resource-rules $x
        done
    fi
fi
