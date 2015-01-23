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
import os
import sys
import time


PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PACKAGE_DIR)


class GeoAppRoot(object):
    """
    Serve the root webpage for our application.
    """
    exposed = True

    def GET(self):
        page = open(os.path.join(ROOT_DIR, 'client/index.html')).read()
        return page


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
        self.server = cherrypy.tree.mount(self.root, '/', appconf)
        # move the girder API from /girder/api to /api
        self.root.api = self.root.girder.api
        del self.root.girder.api
        curConfig = girder.utility.config.getConfig()
        # load plugin is called with plugin, root, appconf, root.api.v1 as apiRoot, curConfig
        # the plugin module is then called with info = {name: plugin, config: appconf, serverRoot: root, apiRoot: root.api.v1, pluginRootDir: (root)}
        # if can modify root, appconf, and apiRoot
        cherrypy.engine.start()
        cherrypy.engine.block()

if __name__ == '__main__':
    app = GeoApp()
    app.start()
