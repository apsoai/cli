#!/bin/bash

startTime=$(date +%s)

cyan=$(tput setaf 6)
red=$(tput setaf 1)
blue=$(tput setaf 4)
magenta=$(tput setaf 5)
gray=$(tput setaf 0)$(tput bold)
green=$(tput setaf 2)
bold=$(tput bold)
reset=$(tput sgr0)
yellow=$(tput setaf 3)

run() {
    debug "\`$@\`"
    eval "$@" 2>&1 | logOutput $1
    return $PIPESTATUS
}
debug() {
    log "debug" "$@"
}
debugCmd() {
    name=$1
    shift
    log "${name}" "$@"
}
info() {
    log "info" "$@"
}
logPrompt() {
    log "prompt" "$@"
}

error() {
    log "error" "$@"
}
log() {
    local type=$(basename $1)
    local args=
    shift

    case ${type} in
        info)
            echo -n "[${green}${type}${reset}]"
            ;;
        error)
            echo -n "[${red}${type}${reset}]"
            ;;
        prompt)
            echo -n "[${magenta}${type}${reset}]"
            args="-n"
            ;;
        debug)
            echo -n "[${gray}${type}${reset}]"
            ;;
        *)
            echo -n "[${yellow}${type}${reset}]"
            ;;
    esac

    echo ${args} " $@"
}

checkError() {
    if [ $? -ne 0 ]; then
        error $1
        showElapsed
        exit 1
    fi
}

logOutput() {
    while read cmdOutput; do
        debugCmd $1 "${cmdOutput}"
    done
}

getBooleanDisplay() {
    if [ "$1" = "y" ]; then
        echo -n Yup
    else
        echo -n Nope
    fi
}
showElapsed() {
    local endTime=$(date +%s)
    local elapsed=$((${endTime} - ${startTime}))
    debug "Finished in ${bold}${elapsed}${reset} seconds"
}
