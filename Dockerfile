FROM node:4.4
ADD . /app
WORKDIR /app
RUN npm install
CMD ["npm", "start"]
EXPOSE 8082
