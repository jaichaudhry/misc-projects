#!/bin/sh
# Copies the page into the SwiftWork Solutions site, which serves it at
# https://swiftworksolutions.com/playwithpjs (Firebase Hosting deploys on every push to its main).
# Then commit and push in that repo.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
site=${1:-"$here/../../SwiftworkSolutionsWebsite"}
target="$site/public/playwithpjs"
mkdir -p "$target"
cp "$here/index.html" "$here/styles.css" "$here/app.js" "$here/config.js" "$target/"
echo "Copied to $target"
