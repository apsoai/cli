#!/bin/bash
## declare an array variable
declare -a array=("controllers" "entities" "repositories" "resolvers" "routes" "services")

# get length of an array
arraylength=${#array[@]}

# use for loop to read all values and indexes
for (( i=1; i<${arraylength}+1; i++ ));
do
  rm src/${array[$i-1]}/*.ts
done