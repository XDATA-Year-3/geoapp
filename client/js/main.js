/* Copyright 2015 Kitware Inc.
 *
 *  Licensed under the Apache License, Version 2.0 ( the "License" );
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

var geoapp = girder;
var app;

moment.suppressDeprecationWarnings = true;

geoapp.App = geoapp.View.extend({
    initialize: function (settings) {
        geoapp.restRequest({
            path: 'user/me'
        }).done(_.bind(function (user) {
            geoapp.eventStream = new geoapp.EventStream();

            this.globalNavView = new geoapp.views.LayoutGlobalNavView({
                parentView: this
            });
            this.render();
            // Once we've rendered the layout, we can start up the routing.
            Backbone.history.start({
                pushState: false
            });
        }, this));
        geoapp.events.on('ga:navigateTo', this.navigateTo, this);
    },
    render: function () {
        return this;
    },
    /* Changes the current body view to the view class specified by view.
     *
     * @param view The view to display in the body.
     * @param [settings={}] Settings to pass to the view initialize() method.
     */
    navigateTo: function (view, settings) {
        var container = this.$('#app-container');

        this.globalNavView.deactivateAll();

        settings = settings || {};

        if (view) {
            if (this.bodyView) {
                this.bodyView.destroy();
            }

            settings = _.extend(settings, {
                el: this.$('#app-container'),
                parentView: this
            });

            /* We let the view be created in this way even though it is
             * normally against convention. */
            /*jshint -W055 */
            // jscs:disable requireCapitalizedConstructors
            this.bodyView = new view(settings);
            // jscs:enable requireCapitalizedConstructors
        } else {
            console.error('Undefined page.');
        }
        return this;
    }

});

/* The navigation is of the form #(primary/route)?(section)=(params).  This
 * updates one of the query parameters to contain an encoded dictionary of
 * parameters.
 *
 * @param base: new base navigation if not null or undefined.
 * @param section: the base name of the query parameter.
 * @param params: a dictionary to encode.
 */
geoapp.updateNavigation = function (base, section, params) {
    var curRoute = Backbone.history.fragment || '',
        routeParts = geoapp.dialogs.splitRoute(curRoute),
        queryString = geoapp.parseQueryString(routeParts.name);
    if (base === null || base === undefined) {
        base = routeParts.base;
    }
    if (queryString[section]) {
        delete queryString[section];
    }
    if (params) {
        queryString[section] = $.param(params);
    }
    var unparsedQueryString = $.param(queryString);
    if (unparsedQueryString.length > 0) {
        unparsedQueryString = '?' + unparsedQueryString;
    }
    geoapp.router.navigate(base + unparsedQueryString);
};

/* Parse a JSON string to an object, returning an empty object on any error.
 *
 * @param jsonValue: the JSON value.
 * @returns: the parsed object or an empty object.
 */
geoapp.parseJSON = function (jsonValue)  {
    try {
        return JSON.parse(jsonValue);
    } catch (err) {
        return {};
    }
};

/* I'd rather use the girder function, but as of girder 1.2.1, the function was
 * defective. */
geoapp.parseQueryString = function (queryString) {
    var params = {};
    if (queryString) {
        _.each(queryString.replace(/\+/g, ' ').split(/&/g), function (el, i) {
            var aux = el.split('='), o = {}, val;
            if (aux.length > 1) {
                val = decodeURIComponent(el.substr(aux[0].length + 1));
            }
            params[decodeURIComponent(aux[0])] = val;
        });
    }
    return params;
};

/* Run this when everything else is loaded */
$(function () {
    girder.apiRoot = 'api/v1';
    geoapp.map = geoapp.Map();

    app = new geoapp.App({el: 'body', parentView: null});
});

/* TODO:
 * - encode and restore map positions via navigation (encode whenever update or
 * filter is called).
 */
