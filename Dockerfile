FROM node:carbon

# Update and get necessary dependencies
RUN apt-get update
RUN apt-get install -y unzip

WORKDIR /usr/src

# Download net64 and unzip it
RUN wget https://github.com/Tarnadas/net64plus-server/archive/master.zip
RUN unzip master.zip

WORKDIR /usr/src/net64plus-server-master

RUN npm install
RUN npm i -g pm2

WORKDIR /usr/src/settings

EXPOSE 3678
EXPOSE 8080

VOLUME /usr/src/overrides

ENTRYPOINT [ "npm", "start" ]

# Copy Setting site
ADD ./settings /usr/src/settings/