FROM ubuntu:14.04
MAINTAINER David Manthey <david.manthey@kitware.com>

# The environment variables beginning with KWDEMO can be used to map this demo
# to the main url space.  See the end of this file.
ENV KWDEMO_READY FALSE

EXPOSE 8080

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    libffi-dev \
    libpq-dev \
    libpython-dev \
    postgresql-client \
    postgresql-common \
    python-pip \
    python-software-properties \
    software-properties-common \
    vim

# Get nodejs apt source
RUN curl -sL https://deb.nodesource.com/setup | sudo bash -
# Add mongo apt source
RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 7F0CEB10 && \
    echo "deb http://repo.mongodb.org/apt/ubuntu "$(lsb_release -sc)"/mongodb-org/3.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.0.list

# Install packages requiring additional sources
RUN apt-get update && apt-get install -y \
    mongodb-org-shell \
    mongodb-org-tools \
    nodejs

RUN npm install -g npm@next && \
    npm --version

RUN npm install -g grunt-cli

# bower does't work particularly well as root, so we create a non-root user
# called kwuser, but give it sudo ability.
RUN adduser --disabled-password --gecos '' kwuser && \
    adduser kwuser sudo && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER kwuser

WORKDIR /home/kwuser

RUN mkdir /home/kwuser/logs

# XDATA's proxy can't use the git protocol
RUN git config --global url."https://".insteadOf git://

RUN git clone git://github.com/XDATA-Year-3/geoapp.git && \
    cd geoapp && \
    git checkout 4b50c88a131e5d726d20493ebf79ef8249b6badf && \
    git reset --hard
WORKDIR /home/kwuser/geoapp
ENV PATH $PATH:/home/kwuser/.local/bin
RUN pip install --user -r requirements.txt && \
    girder-install web && \
    PIP_USER=yes girder-install plugin
RUN git submodule update --init --recursive && \
    git submodule update --recursive && \
    cd geojs && \
    npm install --production && \
    grunt library
RUN curl https://data.kitware.com/api/v1/file/559a77de8d777f649a9ba29f/download -o client/optional/static/weatherboston.json && \
    curl https://data.kitware.com/api/v1/file/559abbbe8d777f649a9ba2ad/download -o client/optional/static/crimeboston.json && \
    curl https://data.kitware.com/api/v1/file/559abbbf8d777f649a9ba2b6/download -o client/optional/static/transitboston.json && \
    curl https://data.kitware.com/api/v1/file/559bd8588d777f649a9ba2d0/download -o client/optional/static/vendorboston.json
RUN curl https://data.kitware.com/api/v1/file/559d4c288d777f649a9ba2ed/download -o client/optional/static/taximodelboston.json
RUN curl https://data.kitware.com/api/v1/file/569902c58d777f429eac9113/download -o client/optional/static/boston-census-permits.json

RUN npm install --production

RUN curl https://data.kitware.com/api/v1/file/559565958d777f649a9ba285/download -o built/video.mp4

COPY makelocalcfg.py /home/kwuser/makelocalcfg.py

ENV KWDEMO_NAME Minerva Boston Permits
ENV KWDEMO_KEY bostonpermits
ENV KWDEMO_SRCURL https://github.com/XDATA-Year-3/geoapp
ENV KWDEMO_DESC Minerva geospatial analysis application of Boston building permits
ENV KWDEMO_IMG /bostonpermits/built/thumb.jpg
ENV KWDEMO_READY TRUE

CMD ["sh", "-c", "python /home/kwuser/makelocalcfg.py > conf/geoapp.local.cfg && python server/main.py"]
