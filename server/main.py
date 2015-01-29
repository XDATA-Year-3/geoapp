#!/usr/bin/env python
# -*- coding: utf-8 -*-

###############################################################################
#  Copyright 2015 Kitware Inc.
#
#  Licensed under the Apache License, Version 2.0 ( the "License" );
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
###############################################################################

import cherrypy
import girder.utility.config
import girder.utility.server
import mako.template
import os
import pprint
import sys
import time

import taxi

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PACKAGE_DIR)


class GeoAppRoot(object):
    """
    Serve the root webpage for our application.
    """
    exposed = True
    indexHtml = None
    vars = {
        'apiRoot': 'api/v1',
        'staticRoot': 'built',
        'girderRoot': 'girder/static',
    }

    def GET(self):
        if self.indexHtml is None:
            page = open(os.path.join(ROOT_DIR, 'built/index.html')).read()
            print '%r' % page
            self.indexHtml = mako.template.Template(page).render(**self.vars)
        return self.indexHtml


class GeoApp():
    def __del__(self):
        cherrypy.engine.exit()

    """Start the server and serve until stopped."""
    def start(self):
        cherrypy.config['database']['uri'] = 'mongodb://localhost:27017/geoapp'
        cherrypy.config['server.socket_port'] = 8001
        self.root = GeoAppRoot()
        # Create the girder services and place them at /girder
        self.root.girder, appconf = girder.utility.server.configureServer()
        curConfig = girder.utility.config.getConfig()
        localappconf = {
            '/built': {
                'tools.staticdir.on': 'True',
                'tools.staticdir.dir': os.path.join(ROOT_DIR, 'built')
            },
            '/girder/static': curConfig['/static']
        }
        appconf.update(localappconf)
        curConfig.update(localappconf)

        self.server = cherrypy.tree.mount(self.root, '/', appconf)
        # move the girder API from /girder/api to /api
        self.root.api = self.root.girder.api
        del self.root.girder.api

        self.root.girder.updateHtmlVars({'staticRoot': '/girder/static'})
        self.root.api.v1.updateHtmlVars({'staticRoot': '/girder/static'})

        info = {
            'config': appconf,
            'serverRoot': self.root,
            'apiRoot': self.root.api.v1
        }
        # load plugin is called with plugin, root, appconf, root.api.v1 as apiRoot, curConfig
        # the plugin module is then called with info = {name: plugin, config: appconf, serverRoot: root, apiRoot: root.api.v1, pluginRootDir: (root)}
        # if can modify root, appconf, and apiRoot

        taxi.load(info)

        cherrypy.engine.start()
        cherrypy.engine.block()

if __name__ == '__main__':
    app = GeoApp()
    app.start()
