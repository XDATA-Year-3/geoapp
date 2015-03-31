#!/usr/bin/env python
# -*- coding: utf-8 -*-

import docker
import os
import pprint
import sys


def getDemoList():
    """
    Get a list of running containers from Docker.  If the container has an
    environment variable called KWDEMO_KEY and at least one exposed port,
    record information about that docker container so that it can be presented
    as a demo.

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
                'IPAddress' not in data['NetworkSettings']):
            continue
        if ('State' not in data or 'StartedAt' not in data['State']):
            continue
        env = {item.split('=', 1)[0]: item.split('=', 1)[1]
               for item in data['Config']['Env'] if '=' in item}
        if 'KWDEMO_KEY' not in env:
            continue
        demo = {
            'id': container['Id'],
            'started': data['State']['StartedAt'],
            'key': env['KWDEMO_KEY'],
            'name': env.get('KWDEMO_NAME', env['KWDEMO_KEY']),
            'desc': env.get('KWDEMO_DESC', ''),
            'url': env.get('KWDEMO_SRCURL', ''),
            'img': env.get('KWDEMO_IMG', ''),
            'ip': data['NetworkSettings']['IPAddress'],
            'ports': []
        }
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


def updateNginx(demos):
    """
    Update an nginx configuratoion file to allow access to all demo containers
    and port.  If there is more than one docker container with the same
    KWDEMO_KEY or more than one port is exposed, all of the containers and
    ports will be available at (key), (key)1, (key)2, etc.

    :param demos: the list of demos as returned by getDemoList.
    """
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
            conf.append('location /%s/ {\n  proxy_pass http://%s:%d/;\n}\n' % (
                key, demo['ip'], port))
    open(os.path.expanduser('~/conf/nginx_proxy_list'), 'wb').write(
        ''.join(conf))
    os.system('sudo /etc/init.d/nginx reload')


def updateIndex(demos):
    """
    Update the index.html page which summaries the available demos.  If there
    is more than one docker container with the same KWDEMO_KEY or more than one
    port exposed, only the lowest numbered port of the first-started container
    will be shown as a thumbnail in the index.

    :param demos: the list of demos as returned by getDemoList.
    """
    keys = {}
    template = open(os.path.expanduser('~/conf/index_template.html')).read()
    mainparts = template.split('%DEMORECORD%')
    page = [mainparts[0]]
    template = mainparts[1]
    for demo in demos:
        key = demo['key']
        if key in keys:
            continue
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
    open(os.path.expanduser('~/demoweb/index.html'), 'wb').write(''.join(page))


if __name__ == '__main__':
    help = False
    for arg in sys.argv[1:]:
        if arg:
            help = True
    if help:
        print """Generate the demo index page and route web directories to the various demos.

Syntax: updatedemo.py

This requires the user to have sudo privilege on '/etc/init.d/nginx reload'.

"""
        sys.exit(0)
    demos = getDemoList()
    pprint.pprint(demos)
    updateIndex(demos)
    updateNginx(demos)
