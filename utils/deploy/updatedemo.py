#!/usr/bin/env python
# -*- coding: utf-8 -*-

import docker
import os
import pprint
import shutil
import sys


def getDemoList():
    """
    Get a list of running containers from Docker.  If the container has an
    environment variable called KWDEMO_KEY and at least one exposed port,
    record information about that docker container so that it can be presented
    as a demo.  If KWDEMO_READY is set to FALSE, then the container will not be
    presented.

    :returns: a list of demos in the order that they were started.
    """
    running = []
    c = docker.Client()
    # Get the list of running containers
    containers = c.containers()
    for container in containers:
        # For each container, see if it has the KWDEMO_
        data = c.inspect_container(container['Id'])
        if ('Config' not in data or 'Env' not in data['Config'] or
                'ExposedPorts' not in data['Config']):
            continue
        if ('NetworkSettings' not in data or
                'Networks' not in data['NetworkSettings'] or
                not data['NetworkSettings']['Networks']):
            continue
        if ('State' not in data or 'StartedAt' not in data['State']):
            continue
        env = {item.split('=', 1)[0]: item.split('=', 1)[1]
               for item in data['Config']['Env'] if '=' in item}
        if 'KWDEMO_KEY' not in env:
            continue

        network_mode = container['HostConfig']['NetworkMode']

        demo = {
            'id': container['Id'],
            'started': data['State']['StartedAt'],
            'key': env['KWDEMO_KEY'],
            'name': env.get('KWDEMO_NAME', env['KWDEMO_KEY']),
            'desc': env.get('KWDEMO_DESC', ''),
            'url': env.get('KWDEMO_SRCURL', ''),
            'img': env.get('KWDEMO_IMG', ''),
            'ip': data['NetworkSettings']['Networks'][network_mode]['IPAddress'],
            'ready': env.get('KWDEMO_READY', ''),
            'ports': []
        }
        if demo['ready'].upper() == 'FALSE':
            continue
        for key in data['Config']['ExposedPorts']:
            if key.endswith('/tcp'):
                try:
                    port = int(key.split('/tcp')[0])
                except Exception:
                    continue
                demo['ports'].append(port)
        if not len(demo['ports']):
            continue
        demo['ports'].sort()
        running.append((demo['started'], demo))
    return [item[1] for item in sorted(running)]


def updateNginx(demos, basePath):
    """
    Update an nginx configuratoion file to allow access to all demo containers
    and port.  If there is more than one docker container with the same
    KWDEMO_KEY or more than one port is exposed, all of the containers and
    ports will be available at (key), (key)1, (key)2, etc.

    :param demos: the list of demos as returned by getDemoList.
    :param basePath: path where conf/nginx_proxy_list is located.
    """
    confFile = os.path.join(basePath, 'conf/nginx_proxy_list')
    keys = {}
    conf = []
    for demo in demos:
        for port in demo['ports']:
            key = demo['key']
            if key not in keys:
                keys[key] = 1
            else:
                key += str(keys[key])
                keys[demo['key']] += 1
            conf.append("""location /%s/ {
  proxy_set_header X-Forwarded-Host $http_host;
  proxy_set_header X-Forwarded-Server $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://%s:%d/;
}\n""" % (key, demo['ip'], port))
    conf = ''.join(conf)
    oldconf = open(confFile).read()
    if conf != oldconf:
        confFileTmp = confFile + '.tmp'
        open(confFileTmp, 'wb').write(conf)
        shutil.move(confFileTmp, confFile)
        os.system('/etc/init.d/nginx reload')


def updateIndex(demos, basePath):
    """
    Update the index.html page which summaries the available demos.  If there
    is more than one docker container with the same KWDEMO_KEY or more than one
    port exposed, only the lowest numbered port of the first-started container
    will be shown as a thumbnail in the index.

    :param demos: the list of demos as returned by getDemoList.
    :param basePath: path where conf/index_template.html and demoweb/index.html
                     are located.
    """
    indexFile = os.path.join(basePath, 'demoweb/index.html')
    keys = {}
    template = open(os.path.join(basePath, 'conf/index_template.html')).read()
    mainparts = template.split('%DEMORECORD%')
    page = [mainparts[0]]
    template = mainparts[1]
    for demo in demos:
        key = demo['key']
        if key in keys:
            continue
        keys[key] = True
        entry = template
        tags = demo.copy()
        if tags['url'] != '':
            tags['source'] = '<p>Source: <a href="%s">%s</a></p>' % (
                tags['url'], tags['url'])
        for tag in tags:
            tagkey = '%%%s%%' % tag
            if tagkey in entry:
                entry = entry.replace(tagkey, tags[tag])
        page.append(entry)
    page.append(mainparts[2])
    page = ''.join(page)
    if os.path.exists(indexFile):
        oldpage = open(indexFile).read()
    else:
        oldpage = ''
    if page != oldpage:
        indexFileTmp = indexFile + '.tmp'
        open(indexFileTmp, 'wb').write(page)
        shutil.move(indexFileTmp, indexFile)


if __name__ == '__main__':
    help = False
    basePath = None
    for arg in sys.argv[1:]:
        if arg and not basePath:
            basePath = arg
        else:
            help = True
    if help:
        print """Generate the demo index page and route web directories to the various demos.

Syntax: updatedemo.py [base path]

The base path should be something like /home/ubuntu or /home/vagrant
This can call '/etc/init.d/nginx reload', so must have privilege to do so.
"""
        sys.exit(0)
    demos = getDemoList()
    pprint.pprint(demos)
    updateIndex(demos, basePath)
    updateNginx(demos, basePath)
