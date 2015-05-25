#!/bin/bash

createuser -U postgres taxi -d -w

# Yellow and Green full taxi data set
createdb -U taxi taxifullg
curl https://data.kitware.com/api/v1/file/55145bf48d777f3f5edf4c64/download | bunzip2 | psql -U taxi taxifullg

# Yellow 1/12 data set
# createdb -U taxi taxi12r
# curl https://data.kitware.com/api/v1/file/55145e168d777f3f5edf4c67/download | bunzip2 | psql -U taxi taxi12r

# Instagram data set
createdb -U taxi instagram
curl https://data.kitware.com/api/v1/file/551c44ee8d777f6aabb78e5f/download | bunzip2 | psql -U taxi instagram

# Instagram combo data set
createdb -U taxi instagramc
curl https://data.kitware.com/api/v1/file/5554f6c88d777f082b592faa/download | bunzip2 | psql -U taxi instagramc

# Instagram syria data set
createdb -U taxi syria
curl https://data.kitware.com/api/v1/file/5555e8978d777f082b592fb0/download | bunzip2 | psql -U taxi syria

