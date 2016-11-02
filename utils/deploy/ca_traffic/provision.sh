#!/bin/bash

# Log in as the expected user (vagrant or ubuntu, for instance), then run this
# as root.

echo Install Mongo 3, nginx, and some tools.

apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv EA312927
echo "deb http://repo.mongodb.org/apt/ubuntu "$(lsb_release -sc)"/mongodb-org/3.2 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-3.2.list

wget -qO- https://deb.nodesource.com/setup_6.x | sudo bash -

apt-get update
apt-get upgrade --force-yes -y
apt-get install --force-yes -y linux-image-extra-$(uname -r) apt-transport-https mongodb-org nginx vim python-pip build-essential curl git libffi-dev libpq-dev libpython-dev postgresql-client postgresql-common python-pip python-software-properties software-properties-common nodejs

# Configure mongo, clearing all data
service mongod stop
rm -r /var/lib/mongodb/*
cat <<EOT > /etc/mongod.conf
dbpath=/var/lib/mongodb
logpath=/var/log/mongodb/mongod.log
logappend=true
bind_ip=0.0.0.0
EOT

cp /vagrant/disable-transparent-hugepages /etc/init.d/disable-transparent-hugepages
chmod a+x /etc/init.d/disable-transparent-hugepages
update-rc.d disable-transparent-hugepages defaults
/etc/init.d/disable-transparent-hugepages start
service mongod start

# Copy .vimrc for comfort
if [ -f /vagrant/.vimrc ]; then
  cp /vagrant/.vimrc /home/vagrant/.
  cp /vagrant/.vimrc /root/.
fi

git config --global url."https://".insteadOf git://

npm install -g grunt-cli

sudo -H -u vagrant /bin/bash /vagrant/user_provision.sh

cp /vagrant/service.geoapp.conf /etc/init/geoapp.conf
chown root:root /etc/init/geoapp.conf
chmod 644 /etc/init/geoapp.conf
ln -s /etc/init/geoapp.conf /etc/init.d/geoapp
initctl reload-configuration
service geoapp start

if [ -f /vagrant/ingest.tgz ]; then
  # Load data we have already ingested into mongo
  pushd /tmp
  tar -zxvf /vagrant/ingest.tgz 
  mongorestore -v --db=pems /tmp/pems
  mongorestore -v --db=twitter /tmp/twitter
  popd
else
  # Load data into mongo and run our ingest process
  mongorestore -v --db=pems /vagrant/twitter-pems/PEMS-Data/mongo/pems-jifx/
  mongorestore -v --db=twitter /vagrant/twitter-pems/Twitter-Data/mongodump/twitter
  sudo -H -u vagrant /bin/bash /vagrant/ingest_provision.sh
fi
