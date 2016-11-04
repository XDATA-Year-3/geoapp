#!/bin/bash

cd /home/vagrant

mkdir -p .local/bin
[[ ":$PATH:" != *":/$HOME/.local/bin:"* ]] && export PATH="${HOME}/.local/bin:${PATH}"

git clone git://github.com/XDATA-Year-3/geoapp.git 
cd geoapp
git checkout 11955b802621762165101a8f2faf7c8bc392e344
git reset --hard

pip install --user -r requirements.txt 
girder-install web 
PIP_USER=yes girder-install plugin
git submodule update --init --recursive 
git submodule update --recursive 
cd geojs 
npm install </dev/null
npm run postinstall </dev/null
grunt init library </dev/null

cd ~/geoapp
npm install </dev/null
grunt init default </dev/null

cp /vagrant/geoapp.local.cfg conf/geoapp.local.cfg

