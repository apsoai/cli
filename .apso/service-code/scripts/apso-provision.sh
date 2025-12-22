#!/usr/bin/env bash
startTime=$(date +%s)


currentDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
rootDir=$(dirname "${currentDir}")
. "${currentDir}/common.sh"

set -o allexport
source "${rootDir}/.env" set
+o allexport

SCHEMA_WILDCARD="${currentDir}/provision/*-schema.sh"
for filename in ${SCHEMA_WILDCARD}; do
    echo $filename
    run $filename
done
