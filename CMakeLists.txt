cmake_minimum_required(VERSION 2.8)

project(geoapp NONE)

include(CTest)
enable_testing()

set(BUILD_TESTING ON CACHE BOOL "Enable geoapp testing")

# set up targets for node programs
set(NODE_MODULES_PATH "${CMAKE_CURRENT_SOURCE_DIR}/node_modules")
set(JSHINT_EXECUTABLE "${NODE_MODULES_PATH}/.bin/jshint")
set(JSCS_EXECUTABLE "${NODE_MODULES_PATH}/.bin/jscs")
set(GRUNT_EXECUTABLE "${NODE_MODULES_PATH}/.bin/grunt")

set(JS_HINT_TESTS ON CACHE BOOL "Generate jshint style tests for JS source files.")
set(JSCS_TESTS ON CACHE BOOL "Generate jscs style tests for JS source files.")

find_package(PythonInterp REQUIRED)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

if(${JS_HINT_TESTS})

  add_custom_target(
    jshint-binary
    ALL
    DEPENDS "${JSHINT_EXECUTABLE}"
  )
  add_test(
    NAME "jshint"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMAND "${JSHINT_EXECUTABLE}" "client/js"
  )

endif() # JS_HINT_TESTS

if(${JSCS_TESTS})

  add_custom_target(
    jscs-binary
    ALL
    DEPENDS "${JSCS_EXECUTABLE}"
  )
  add_test(
    NAME "jscs"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMAND "${JSCS_EXECUTABLE}" "client/js"
  )

endif() # JSCS_TESTS

