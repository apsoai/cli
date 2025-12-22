#!/usr/bin/env bash

currentDir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
rootDir=$(dirname "${currentDir}")
. "${currentDir}/../common.sh"

# HOSTNAME="127.0.0.1"
# PORT="54322"
# ROOT_USERNAME="root"
# ROOT_PASSWORD="root"
# ROOT_DATABASE="postgres"

rootDatabaseCall() {
    local sql=$1
    local HOSTNAME=$2
    local PORT=$3
    local ROOT_USERNAME=$4
    local ROOT_PASSWORD=$5
    local ROOT_DATABASE=$6

    run PGPASSWORD="${ROOT_PASSWORD}" \
    psql -h "${HOSTNAME}" \
    -U "${ROOT_USERNAME}" \
    -p ${PORT} \
    -d "${ROOT_DATABASE}" \
    -c \""${sql}"\"
}

schemaDatabaseCall() {
    local DATABASE=$1
    local sql=$2
    local HOSTNAME=$3
    local PORT=$4
    local ROOT_USERNAME=$5
    local ROOT_PASSWORD=$6
    local ROOT_DATABASE=$7

    run PGPASSWORD="${ROOT_PASSWORD}" \
    psql -h "${HOSTNAME}" \
    -U "${ROOT_USERNAME}" \
    -p ${PORT} \
    -d "${DATABASE}" \
    -c \""${sql}"\"
}

resetDatabase() {
    local DATABASE=$1
    local HOSTNAME=$2
    local PORT=$3
    local ROOT_USERNAME=$4
    local ROOT_PASSWORD=$5
    local ROOT_DATABASE=$6
    rootDatabaseCall "drop database if exists ${DATABASE};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    rootDatabaseCall "create database ${DATABASE};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
}

createDatabaseUser() {
    local USER=$1
    local PASSWORD=$2
    local DATABASE=$3
    local HOSTNAME=$4
    local PORT=$5
    local ROOT_USERNAME=$6
    local ROOT_PASSWORD=$7
    local ROOT_DATABASE=$8
    rootDatabaseCall "create user ${USER} with password '${PASSWORD}';" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    rootDatabaseCall "grant all on database ${DATABASE} to ${USER};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
}

createDatabaseSchema() {
    local USER=$1
    local DATABASE=$2
    local SCHEMA=$3
    
    schemaDatabaseCall $DATABASE "revoke usage on schema public from public;" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    schemaDatabaseCall $DATABASE "drop schema public;" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    schemaDatabaseCall $DATABASE "alter database ${DATABASE} owner to ${USER};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    schemaDatabaseCall $DATABASE "create schema ${SCHEMA};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    schemaDatabaseCall $DATABASE "GRANT ALL ON SCHEMA ${SCHEMA} TO ${USER}" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
    schemaDatabaseCall $DATABASE "alter role ${USER} SET search_path=${SCHEMA};" $HOSTNAME $PORT $ROOT_USERNAME $ROOT_PASSWORD $ROOT_DATABASE
}