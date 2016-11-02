#!/bin/bash

cd /home/vagrant

mkdir -p .local/bin
[[ ":$PATH:" != *":/$HOME/.local/bin:"* ]] && export PATH="${HOME}/.local/bin:${PATH}"

git clone git://github.com/XDATA-Year-3/geoapp.git 
cd geoapp
git checkout da3d9abef295dda66ad3ed95147c3ac5ba65f04e
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

