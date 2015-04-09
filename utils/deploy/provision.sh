# Log in as the expected user (vagrant or ubuntu, for instance), then run this
# as root in the directory in the directory where updatedemo.py is located.

echo Install Mongo 3, the latest Docker, PostgreSQL 9.4, nginx, and some tools.

apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 7F0CEB10
echo "deb http://repo.mongodb.org/apt/ubuntu "$(lsb_release -sc)"/mongodb-org/3.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-3.0.list

apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 36A1D7869245C8950F966E92D8576A8BA88D21E9
echo 'deb https://get.docker.com/ubuntu docker main' | tee /etc/apt/sources.list.d/docker.list

wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
echo "deb http://apt.postgresql.org/pub/repos/apt/ "$(lsb_release -sc)"-pgdg" main | tee /etc/apt/sources.list.d/pgdg.list

apt-get update
apt-get install --force-yes -y inux-image-extra-$(uname -r) apt-transport-https lxc-docker mongodb-org postgresql-9.4 nginx vim python-pip 
pip install docker-py


/etc/init.d/mongod stop
rm -r /var/lib/mongodb/*
cat <<EOT > /etc/mongod.conf
dbpath=/var/lib/mongodb
logpath=/var/log/mongodb/mongod.log
logappend=true
storageEngine=wiredTiger
EOT
/etc/init.d/mongod restart


# Make our default user a member of the docker group so we can docker without
# sudo later
groupadd docker
gpasswd -a `logname` docker
service docker restart
# If you are logged in when doing this, you would need to logout and back in
# to get access to the group, or activate the new group using newgrp
# newgrp docker

## Copy my preferred vimrc file
#cp geoapp/.vimrc /home/`logname`/.vimrc

# Set up our demo web site root
mkdir /home/`logname`/demoweb
mkdir /home/`logname`/conf
echo '' > /home/`logname`/conf/nginx_proxy_list

# Copy the program that updates our demo web site
cp index_template.html /home/`logname`/conf/.
cp updatedemo.py /home/`logname`/conf/.
cp geoapp.png /home/`logname`/demoweb/.

cat <<EOT > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server ipv6only=on;

    root /home/`logname`/demoweb;
    index index.html index.htm;

    proxy_connect_timeout 3600;
    proxy_send_timeout    3600;
    proxy_read_timeout    3600;
    send_timeout          3600;

    # Make site accessible from http://localhost/
    server_name localhost;

    include /home/`logname`/conf/nginx_proxy_list;

    location / {
        # First attempt to serve request as file, then
        # as directory, then fall back to displaying a 404.
        try_files \$uri \$uri/ =404;
    }
}
EOT
/etc/init.d/nginx restart

# Determine host IP as perceived by a docker container
dockerhostip=`ip route show | grep -Eo 'docker.*src \S+' | awk '{ print $7 }'`

cat <<EOT > /etc/postgresql/9.4/main/pg_hba.conf
local all all trust
host all all 127.0.0.1/32 trust
host all all ::1/128 trust
host all all $dockerhostip/12 trust
EOT
echo "listen_addresses='*'" >> /etc/postgresql/9.4/main/postgresql.conf
/etc/init.d/postgresql restart

crontab -l | { cat; echo "* * * * * python /home/`logname`/conf/updatedemo.py /home/`logname`"; } | crontab -

## Stop and remove all existing docker containers and images
#docker stop $(docker ps -a -q)
#docker kill $(docker ps -a -q)
#docker rm $(docker ps -a -q)
#docker rmi $(docker images -q)

# docker build -t kitware/geoapp geoapp
# docker run -d --restart=always --name=geoapp-current kitware/geoapp
