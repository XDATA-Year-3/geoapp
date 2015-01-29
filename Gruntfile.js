/**
 * Copyright 2015 Kitware Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = function (grunt) {
    var staticRoot;
    var fs = require('fs');
    var jade = require('jade');
    var path = require('path');

    var defaultTasks = ['stylus', 'build-js', 'copy:static'];

    // Pass a "--env=<value>" argument to grunt. Default value is "dev".
    var environment = grunt.option('env') || 'dev';

    var setServerConfig = function (err, stdout, stderr, callback) {
        if (err) {
            grunt.fail.fatal('config_parse failed on local.server.cfg: ' + stderr);
        }
        try {
            var cfg = JSON.parse(stdout);
            staticRoot = ((cfg.server && cfg.server.static_root) || '/static').replace(/\"/g, "");
            console.log('Static root: ' + staticRoot.bold);
        }
        catch (e) {
            grunt.warn('Invalid json from config_parse: ' + stdout);
        }
        callback();
    };

    // Returns a json string containing information from the current git repository.
    var versionInfoObject = function () {
        var gitVersion = grunt.config.get('gitinfo');
        var local = gitVersion.local || {};
        var branch = local.branch || {};
        var current = branch.current || {};
        return JSON.stringify(
            {
                git: !!current.SHA,
                SHA: current.SHA,
                shortSHA: current.shortSHA,
                date: grunt.template.date(new Date(), "isoDateTime", true),
                apiVersion: grunt.config.get('pkg').version
            },
            null,
            "  "
        );
    };

    // Project configuration.
    grunt.config.init({
        pkg: grunt.file.readJSON('package.json'),

        jade: {
            options: {
                client: true,
                compileDebug: false,
                namespace: 'geoapp.templates',
                processName: function (filename) {
                    return path.basename(filename, '.jade');
                }
            },
            core: {
                files: {
                    'built/templates.js': [
                        'client/templates/**/*.jade'
                    ]
                }
            }
        },

        copy: {
            static: {
                    expand: true,
                    cwd: 'client/static',
                    src: ['**/*'],
                    dest: 'built'
            }
        },

        stylus: {
            core: {
                files: {
                    'built/app.min.css': [
                        'client/stylesheets/**/*.styl',
                        '!client/stylesheets/apidocs/*.styl'
                    ],
                }
            }
        },

        cssmin: {
            libs: {
                files: {
                    'built/libs.min.css': [
                        'node_modules/bootstrap/dist/css/bootstrap.css'
                    ],
                }
            }
        },

        shell: {
            sphinx: {
                command: [
                    'cd docs',
                    'make html'
                ].join('&&'),
                options: {
                    stdout: true
                }
            },
            // DWM::
            readServerConfig: {
                command: 'python config_parse.py girder/conf/girder.local.cfg',
                options: {
                    stdout: false,
                    callback: setServerConfig
                }
            },
        },

        uglify: {
            options: {
                sourceMap: environment === 'dev',
                sourceMapIncludeSources: true,
                report: 'min',
                beautify: {
                    ascii_only: true
                }
            },
            app: {
                files: {
                    'built/app.min.js': [
                        'built/templates.js',
                        'client/js/**/*.js',
                    ],
                    /* DWM::
                    'built/main.min.js': [
                        'clients/web/src/main.js'
                    ]
                    */
                }
            },
            libs: {
                files: {
                    'built/libs.min.js': [
                        'node_modules/jquery/dist/jquery.js',
                        'node_modules/jade/runtime.js',
                        'node_modules/underscore/underscore.js',
                        'node_modules/backbone/backbone.js',
                        'node_modules/markdown/lib/markdown.js',
                        'node_modules/bootstrap/dist/js/bootstrap.js',
                        /*
                        'clients/web/lib/js/d3.js',
                        'clients/web/lib/js/bootstrap-switch.js',
                        'clients/web/lib/js/jquery.jqplot.js',
                        'clients/web/lib/js/jqplot.pieRenderer.js',
                        'clients/web/lib/js/sprintf.js'
                        */
                    ],
                    'built/testing.min.js': [
                        /*
                        'clients/web/test/lib/jasmine-1.3.1/jasmine.js',
                        'node_modules/blanket/dist/jasmine/blanket_jasmine.js',
                        'clients/web/test/lib/jasmine-1.3.1/ConsoleReporter.js'
                        */
                    ]
                }
            }
        },

        watch: {
            stylus_core: {
                files: ['client/stylesheets/**/*.styl'],
                tasks: ['stylus:core']
            },
            js_core: {
                files: ['clients/js/**/*.js'],
                tasks: ['uglify:app']
            },
            jade_core: {
                files: ['client/templates/**/*.jade'],
                tasks: ['build-js']
            },
            sphinx: {
                files: ['docs/*.rst'],
                tasks: ['docs']
            }
        },
    });

    if (['dev', 'prod'].indexOf(environment) === -1) {
        grunt.fatal('The "env" argument must be either "dev" or "prod".');
    }

    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-contrib-jade');
    grunt.loadNpmTasks('grunt-contrib-stylus');
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-contrib-cssmin');
    grunt.loadNpmTasks('grunt-gitinfo');
    grunt.loadNpmTasks('grunt-contrib-compress');

    /*
    grunt.registerTask('test-env-html', 'Build the phantom test html page.', function () {
        var buffer = fs.readFileSync('client/test/testEnv.jadehtml');
        var globs = grunt.config('uglify.app.files')['built/app.min.js'];
        var inputs = [];
        globs.forEach(function (glob) {
            var files = grunt.file.expand(glob);
            files.forEach(function (file) {
                inputs.push('/' + file);
            });
        });

        var fn = jade.compile(buffer, {
            client: false,
            pretty: true
        });
        fs.writeFileSync('built/testEnv.html', fn({
            cssFiles: [
                '/static/lib/bootstrap/css/bootstrap.min.css',
                '/static/lib/bootstrap/css/bootstrap-switch.min.css',
                '/static/lib/fontello/css/fontello.css',
                '/built/app.min.css'
            ],
            jsFiles: inputs,
            staticRoot: staticRoot
        }));
    });
    */

    grunt.registerTask('version-info', [
        'gitinfo',
    ]);

    grunt.registerTask('build-js', [
        'jade',
        'version-info',
        'uglify:app',
//        'shell:readServerConfig',
//        'test-env-html'
    ]);
    grunt.registerTask('init', [
        'uglify:libs',
        'cssmin:libs',
//        'shell:readServerConfig'
    ]);
    grunt.registerTask('docs', ['shell:sphinx']);
    grunt.registerTask('default', defaultTasks);
};
