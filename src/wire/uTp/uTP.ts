const utp = require('utp-native')
import * as types from 'node:net'

const server: types.Server = utp.createServer(function (socket: types.Socket) {
  socket.pipe(socket) // echo server
})

server.listen(10000, function () {
  const socket: types.Socket = utp.connect(10000)

  socket.write('hello world')
  socket.end()

  socket.on('data', function (data: unknown) {
    console.log('echo: ' + data)
  })
  socket.on('end', function () {
    console.log('echo: (ended)')
  })
})