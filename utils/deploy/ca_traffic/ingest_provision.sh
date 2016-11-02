#!/bin/bash

# Convert data to a prefered format
# python /vagrant/ingest_pems.py
python /vagrant/ingest_twitter.py
# Statistical sampling
python /vagrant/ingest_flow.py
python /vagrant/ingest_incidents.py

