geoapp.intents = {
    /* Fetch a dictionary of intents from a server.  After fetching it, show a
     * menu.
     *
     * @param intentsData: a dictionary of information to pass to the intents
     *                     server.
     * @param target: the target element used to align the displayed menu.
     * @param direct: if falsy, use the rest end point.  If truthy, use a
     *                direct query.  If undefined, use the settings value.
     */
    getIntents: function (intentsData, target, direct) {
        var xhr;
        if (direct === undefined) {
            direct = $('body').attr('intentsdirect') === 'true';
        }
        geoapp.cancelRestRequests('intents');
        if (!direct) {
            xhr = geoapp.restRequest({
                path: 'geoapp/intents', data: intentsData
            });
        } else {
            var param = {
                url: $('body').attr('intentsserver'),
                dataType: 'json',
                data: intentsData
            };
            if (param.url.substr(0, 4) === 'http' &&
                    param.url.indexOf('@') >= 0 &&
                    param.url.indexOf('@') < param.url.indexOf('/', 8)) {
                var auth = param.url.split('/')[2].split('@')[0];
                param.username = auth.split(':')[0];
                param.password = auth.split(':')[1];
                param.url = (param.url.substr(0, param.url.indexOf('/') + 2) +
                             param.url.substr(param.url.indexOf('/') +
                                              auth.length + 3));
                param.xhrFields = {withCredentials: true};
            }
            xhr = Backbone.ajax(param);
        }
        xhr.done(_.bind(function (resp) {
            geoapp.intents.showMenu(intentsData, target, resp);
        }, this));
        xhr.girder = {intents: true};

    },

    /* Show the intents menu next to a target control.
     *
     * @param intentsData: information that was sent to the intents server.
     * @param target: the target element used to align the displayed menu.
     * @param intents: the results from the server.
     */
    showMenu: function (intentsData, target, intents) {
        if (!_.size(intents)) {
            console.log('Got back an empty intents list.');
            return;
        }
        var widget = new geoapp.views.IntentsMenu({
            el: $('#g-dialog-container'),
            intentsData: intentsData,
            target: target,
            intents: intents,
            parentView: geoapp.map.parentView
        });
        widget.render();
    }
};

geoapp.views.IntentsMenu = geoapp.View.extend({
    events: {
    },

    /* Initialize the widget.  The settings include:
     *  el: the container element for the widget.  Typically
     *      $('#g-dialog-container').
     *  intents: the known intents.
     *  target: the control that was selected.
     *  intentsData: the original data used to get intents.
     *
     * @param settings: settings dictionary, as above.
     */
    initialize: function (settings) {
        geoapp.View.prototype.initialize.apply(this, arguments);
        this.settings = settings || {};
        this.viewName = 'IntentsMenu';
    },

    /* Draw the menu.
     */
    render: function () {
        var target = this.settings.target,
            intents = this.settings.intents;
        this.$el.html(geoapp.templates.intentsMenu({
            intents: intents
        })).girderModal(this).on('shown.bs.modal', function () {
            var w = $('.ga-intents-dialog').outerWidth(true),
                h = $('.ga-intents-dialog').outerHeight(true),
                mapW = $('#ga-main-map').width(),
                mapH = $('#ga-main-map').height(),
                tx = $(target).offset().left,
                ty = $(target).offset().top,
                tw = $(target).outerWidth(false),
                th = $(target).outerHeight(false),
                x = tx + tw + 5,
                y = Math.max(0, Math.min(ty + th / 2 - h / 2, mapH - h));
            if (x + w > mapW) {
                x = tx - 5 - w;
            }
            $('.ga-intents-dialog').css({
                left: x + 'px', top: y + 'px', visibility: 'visible'});
        });
        geoapp.View.prototype.render.apply(this, arguments);
        return this;
    }
});
