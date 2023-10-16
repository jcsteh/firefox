#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/. */

set -e

if test "${ACTION}" != "clean"; then
    TOPSRCDIR="${SRCROOT}/../../.."

    if [ -z "${TOPOBJDIR}" ]; then
        TOPOBJDIR=`"${TOPSRCDIR}/mach" environment --format=json | python3 -c 'import sys, json; print(json.load(sys.stdin)["topobjdir"])'`
        if [ -z "${TOPOBJDIR}" ]; then
            echo "Error: Could not determine TOPOBJDIR"
        fi
    fi

    echo "Copying files from ${TOPOBJDIR}/dist/bin"
    echo "Copying files to $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks"
    rsync -pvtrlL --exclude "Test*" \
          --exclude "test_*" --exclude "*_unittest" \
          --exclude xulrunner  \
          "${TOPOBJDIR}/dist/bin/" "$BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks"

    echo "${__IS_NOT_SIMULATOR}"
    if test "${__IS_NOT_SIMULATOR}" = "YES"; then
        for x in $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks/*.dylib $BUILT_PRODUCTS_DIR/$CONTENTS_FOLDER_PATH/Frameworks/XUL; do
            echo "Signing $x"
            /usr/bin/codesign --force --sign "${EXPANDED_CODE_SIGN_IDENTITY}" --preserve-metadata=identifier,entitlements,resource-rules $x
        done
    fi
fi
