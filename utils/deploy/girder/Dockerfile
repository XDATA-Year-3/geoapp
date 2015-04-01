FROM ubuntu:14.04
MAINTAINER David Manthey <david.manthey@kitware.com>

# The environment variables beginning with KWDEMO can be used to map this demo
# to the main url space
ENV KWDEMO_NAME Girder 1.2.4 Demo
ENV KWDEMO_KEY girder1.2.4
ENV KWDEMO_SRCURL https://github.com/girder/girder
ENV KWDEMO_DESC Girder is a free and open source web-based data management platform.  Girder is both a standalone application and a platform for building new web services.
ENV KWDEMO_IMG /girder1.2.4/static/img/Girder_Mark.png

EXPOSE 8080

RUN apt-get update && apt-get install -y \
    libffi-dev \
    libpython-dev \
    python-pip

RUN pip install girder==1.2.4 && \
    girder-install web && \
    girder-install plugin

# Create a user
RUN adduser --disabled-password --gecos '' kwuser && \
    adduser kwuser sudo && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

COPY makelocalcfg.py /home/kwuser/makelocalcfg.py
RUN python /home/kwuser/makelocalcfg.py > /etc/girder.cfg

USER kwuser

WORKDIR /home/kwuser

CMD ["python", "-m", "girder"]
