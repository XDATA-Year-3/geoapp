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

/* global geoapp: true */
var geoapp = girder;
var m_lastUpdateNavigationSection;

moment.suppressDeprecationWarnings = true;

geoapp.version = '0.1';

geoapp.App = geoapp.View.extend({
    initialize: function () {
        geoapp.restRequest({
            path: 'user/me'
        }).done(_.bind(function () {
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
        this.globalNavView.deactivateAll();

        settings = settings || {};

        if (view && this.bodyView instanceof view &&
            this.bodyView.reinitialize) {
            this.bodyView.reinitialize(settings);
        } else if (view) {
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

/* We have to replace the default girder route handling for closing modals and
 * tooltips, because it would destroy the permament tooltips used by sliders.
 */
geoapp.router.off('route').on('route', function (route, params) {
    if (!params.slice(-1)[0].dialog) {
        $('.modal').girderModal('close');
    }
    /* get rid of tooltips, but not those from sliders */
    $('.tooltip').not('.slider .tooltip').remove();
});

/* The navigation is of the form #(primary/route)?(section)=(params).  This
 * updates one of the query parameters to contain an encoded dictionary of
 * parameters.
 *
 * @param base: new base navigation if not null or undefined.
 * @param section: the base name of the query parameter.
 * @param params: a dictionary to encode.
 * @param modify: if true, modify existing parameters.  Otherwise, the
 *                specified section is replaced with the new parameters.
 * @param combine: if true and the last call to updateNavigation was the same
 *                 section, replace the previous navigation rather than adding
 *                 to the history.
 */
geoapp.updateNavigation = function (base, section, params, modify, combine) {
    var curRoute = Backbone.history.fragment || '',
        routeParts = geoapp.dialogs.splitRoute(curRoute),
        queryString = geoapp.parseQueryString(routeParts.name);
    if (base === null || base === undefined) {
        base = routeParts.base;
    }
    if (queryString[section]) {
        if (modify) {
            params = $.extend(
                geoapp.parseQueryString(queryString[section]), params);
        }
        delete queryString[section];
    }
    if (params) {
        queryString[section] = $.param(params);
    }
    var unparsedQueryString = $.param(queryString);
    if (unparsedQueryString.length > 0) {
        unparsedQueryString = '?' + unparsedQueryString;
    }
    if (section !== m_lastUpdateNavigationSection) {
        combine = false;
    }
    m_lastUpdateNavigationSection = section;
    geoapp.router.navigate(base + unparsedQueryString, {replace: combine});
};

/* Parse a JSON string to an object, returning an empty object on any error.
 *
 * @param jsonValue: the JSON value.
 * @returns: the parsed object or an empty object.
 */
geoapp.parseJSON = function (jsonValue) {
    try {
        return JSON.parse(jsonValue);
    } catch (err) {
        return {};
    }
};

/* Run this when everything else is loaded */
$(function () {
    girder.apiRoot = 'api/v1';
    geoapp.map = geoapp.Map();
    geoapp.app = new geoapp.App({el: 'body', parentView: null});
    geoapp.dataLoaders = {};
    _.each(geoapp.dataHandlers, function (handlerFunc, handlerKey) {
        geoapp.dataLoaders[handlerKey] = handlerFunc();
    });
    $.ajax({
        url: $('body').attr('staticRoot') + '/weather.json',
        success: function (data) {
            geoapp.staticData = geoapp.staticData || {};
            geoapp.staticData.weather = data;
        }});
});
