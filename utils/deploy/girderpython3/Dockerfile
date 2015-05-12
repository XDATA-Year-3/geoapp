FROM ubuntu:14.04
MAINTAINER David Manthey <david.manthey@kitware.com>

ENV KWDEMO_READY FALSE

EXPOSE 8080

RUN apt-get update && apt-get install -y \
    libffi-dev \
    libpython-dev \
    python3-pip \
    curl \
    git

RUN ln -s /usr/bin/python3 /usr/bin/python
RUN ln -s /usr/bin/pip3 /usr/bin/pip

#RUN apt-get install -y software-properties-common && \
#    add-apt-repository ppa:fkrull/deadsnakes && \
#    apt-get update && \
#    apt-get install -y python3.3 libpython3.3-dev && \
#    rm /usr/bin/python && \
#    ln -s /usr/bin/python3.3 /usr/bin/python && \
#    python --version && \
#    python /usr/bin/pip3 --version

# Get nodejs apt source
RUN curl -sL https://deb.nodesource.com/setup | sudo bash -
RUN apt-get update && apt-get install -y \
    nodejs

RUN npm install -g npm@next && \
    npm --version

RUN npm install -g grunt-cli

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8

# Create a user
RUN adduser --disabled-password --gecos '' kwuser && \
    adduser kwuser sudo && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER kwuser

WORKDIR /home/kwuser

RUN git config --global url."https://".insteadOf git://

RUN git clone git://github.com/girder/girder.git && \
#    cd girder && \
#    git checkout ac66979e7c092a35addec7979c09d2e9f3d7e473 && \
#    git reset --hard && \
    true

WORKDIR /home/kwuser/girder

RUN python /usr/bin/pip3 install --user \
    -r requirements.txt \
    -r plugins/geospatial/requirements.txt \
#    -r plugins/metadata_extractor/requirements.txt \
    -r plugins/celery_jobs/requirements.txt
#    -r plugins/hdfs_assetstore/requirements.txt \
#    -r requirements-dev.txt

RUN npm install --production
RUN grunt init && grunt

COPY makelocalcfg.py /home/kwuser/makelocalcfg.py

# The environment variables beginning with KWDEMO can be used to map this demo
# to the main url space
ENV KWDEMO_NAME Girder Master Python3 Demo
ENV KWDEMO_KEY girderpython3
ENV KWDEMO_SRCURL https://github.com/girder/girder
ENV KWDEMO_DESC Girder is a free and open source web-based data management platform.  Girder is both a standalone application and a platform for building new web services.  This shows that Girder works with Python3.
ENV KWDEMO_IMG /girderpython3/static/img/Girder_Mark.png

RUN python3 /home/kwuser/makelocalcfg.py > girder/conf/girder.local.cfg

RUN python --version

ENV KWDEMO_READY TRUE

CMD ["python", "-m", "girder"]
