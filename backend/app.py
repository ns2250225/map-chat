from flask import Flask, request, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import os

app = Flask(__name__, static_folder='../frontend/build', static_url_path='/')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# 存储用户信息
users = {}

def broadcast_user_update():
    """广播用户更新给所有客户端"""
    print('广播用户更新:', users)
    socketio.emit('update_users', users)

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in users:
        user = users[request.sid]
        del users[request.sid]
        # 广播用户断开连接的消息
        socketio.emit('user_disconnected', {
            'userId': request.sid,
            'userName': user['name']
        })
        # 广播更新后的用户列表
        broadcast_user_update()
        print(f'Client disconnected: {request.sid}')

@socketio.on('user_login')
def handle_login(data):
    print(f'收到登录请求: {data}')
    # 保存用户信息
    users[request.sid] = {
        'id': request.sid,
        'name': data['name'],
        'contact': data.get('contact', ''),
        'bio': data.get('bio', ''),
        'avatar': data.get('avatar', ''),
        'position': data.get('position', None)
    }
    print(f'保存用户信息: {users[request.sid]}')
    # 广播更新后的用户列表
    broadcast_user_update()
    print(f'User logged in: {data["name"]} ({request.sid})')

@socketio.on('update_position')
def handle_position_update(position):
    print(f'收到位置更新: {position} from {request.sid}')
    if request.sid in users:
        users[request.sid]['position'] = position
        # 广播更新后的用户列表
        broadcast_user_update()
        print(f'Updated position for user: {users[request.sid]["name"]}')

@socketio.on('update_profile')
def handle_profile_update(data):
    if request.sid in users:
        # 更新用户信息
        users[request.sid].update({
            'name': data.get('name', users[request.sid]['name']),
            'contact': data.get('contact', users[request.sid]['contact']),
            'bio': data.get('bio', users[request.sid]['bio']),
            'avatar': data.get('avatar', users[request.sid]['avatar'])
        })
        # 广播更新后的用户列表
        broadcast_user_update()
        print(f'Profile updated for user: {users[request.sid]["name"]}')

@socketio.on('private_message')
def handle_private_message(data):
    recipient_sid = data['to']
    message = data['message']
    sender_sid = request.sid
    
    if sender_sid in users:
        sender_name = users[sender_sid]['name']
        
        # 发送给接收者（如果接收者在线）
        if recipient_sid in users:
            # 发送给接收者
            emit('private_message', {
                'from': sender_sid,
                'sender_name': sender_name,
                'message': message
            }, room=recipient_sid)
            
            # 发送给发送者（不需要通知）
            emit('private_message', {
                'from': sender_sid,
                'sender_name': sender_name,
                'message': message,
                'is_self': True
            }, room=sender_sid)

@app.route('/')
def serve():
    return send_from_directory(app.static_folder, 'index.html')

@app.errorhandler(404)
def not_found(e):
    return send_from_directory(app.static_folder, 'index.html')


if __name__ == '__main__':
    # Use 0.0.0.0 to make the server accessible on your local network
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 