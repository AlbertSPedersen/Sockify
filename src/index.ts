import { connect } from 'cloudflare:sockets'


async function webToTcp(serverWebSocket: WebSocket, serverTcpSocket: Socket) {
	const writer = serverTcpSocket.writable.getWriter()

	serverWebSocket.addEventListener('close', async () => {
		await writer.close()
	})

	serverWebSocket.addEventListener('error', async (error) => {
		await writer.abort(error.message)
	})

	serverWebSocket.addEventListener('message', async (event) => {
		if (typeof event.data === 'string') {
			serverWebSocket.close(1003, 'Received text frame')
			writer.abort('Received text frame from WebSocket client')
		}

		try {
			await writer.write(event.data)
		} catch(error) {
			serverWebSocket.close(1002, `Failed to write data to TCP socket: ${error.message}`)
		}
	})

	serverWebSocket.accept()

	const reader = serverTcpSocket.readable.getReader()

	while (true) {
		try {
			const { value, done } = await reader.read()

			if (done) {
				serverWebSocket.close(1000, 'TCP socket was closed')
				break
			}

			serverWebSocket.send(value)			
		} catch(error) {
			serverWebSocket.close(1002, `Failed to read data from TCP socket: ${error.message}`)
			break
		}
	}
}

export default {
	async fetch(request: Request) {
		const requestUrl = new URL(request.url)

		if (requestUrl.pathname === '/v1/bridge/ws') {
			if (request.method !== 'GET') {
				return new Response(null, {
					status: 405
				})
			}

			const protocol = requestUrl.searchParams.get('protocol')

			if (protocol === null) {
				return new Response("Missing 'protocol' parameter", {
					status: 400
				})
			}

			const address = requestUrl.searchParams.get('address')

			if (address === null) {
				return new Response("Missing 'address' parameter", {
					status: 400
				})
			}

			if (request.headers.get('Connection')?.toLowerCase() !== 'upgrade') {
				return new Response("Missing 'Connection: Upgrade' header")
			}

			if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
				return new Response("Missing 'Upgrade: websocket' header")
			}

			const [ clientWebSocket, serverWebSocket ] = Object.values(new WebSocketPair())

			switch(protocol) {
				case 'tcp': {
					let socket: Socket

					try {
						socket = connect(address)
					} catch(error) {
						return new Response(`Invalid address: ${error.message}`, {
							status: 400
						})
					}

					webToTcp(serverWebSocket, socket)

					return new Response(null, {
						status: 101,
						webSocket: clientWebSocket
					})
				}
				
				default: {
					return new Response(`Unsupported protocol`, {
						status: 400
					})
				}
			}
		}

		return new Response(null, {
			status: 404
		})
	}
}