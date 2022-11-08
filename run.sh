#!/bin/bash
#first move the node folder in .nvm to /usr/local
systemctl stop externalbotd.service
cp externalbotstart.sh /usr/local/bin
cp externalbotstop.sh /usr/local/bin
cp externalbotd.service /etc/systemd/system/externalbotd.service

chmod 744 /usr/local/bin/externalbotstart.sh
chmod 744 /usr/local/bin/externalbotstop.sh
chmod 664 /etc/systemd/system/externalbotd.service

systemctl daemon-reload
systemctl enable externalbotd.service
systemctl start externalbotd.service

#ps aux | grep forever