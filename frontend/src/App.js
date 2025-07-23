import React, { useState, useEffect, useMemo, useRef } from 'react';
import io from 'socket.io-client';
import { Map } from '@uiw/react-baidu-map';
import './App.css';

// Connect to the backend dynamically
// const socket = io(window.location.origin);
const socket = io('http://localhost:5000');

// 默认头像列表
const DEFAULT_AVATARS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=1',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=2',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=3',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=4',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=5',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=6',
];

// 自定义标记组件
const UserMarker = ({ user, isCurrent = false, onClick, position, map }) => {
  useEffect(() => {
    if (map && position) {
      const point = new window.BMap.Point(position.lng, position.lat);
      const content = `
        <div class="map-marker ${isCurrent ? 'current-user' : ''}">
          <div class="marker-content">
            <div class="marker-avatar">
              <img src="${user.avatar}" alt="${user.name}" />
            </div>
            <div class="marker-name">
              ${user.name}
              ${isCurrent ? '<span class="marker-status">（我）</span>' : ''}
            </div>
          </div>
        </div>
      `;
      
      const label = new window.BMap.Label(content, {
        position: point,
        offset: new window.BMap.Size(0, 0)
      });
      
      label.setStyle({
        border: 'none',
        background: 'transparent'
      });

      if (onClick) {
        label.addEventListener('click', () => onClick(user));
      }

      map.addOverlay(label);

      return () => {
        map.removeOverlay(label);
      };
    }
  }, [map, position, user, isCurrent, onClick]);

  return null;
};

function App() {
  const [users, setUsers] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [position, setPosition] = useState(null);
  const [chatTarget, setChatTarget] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATARS[0]);
  const [notifications, setNotifications] = useState([]);
  const [map, setMap] = useState(null);
  const mapRef = useRef();
  const infoWindowRef = useRef(null); // Ref for the native InfoWindow instance
  const notificationTimeoutsRef = useRef({});
  const [userCount, setUserCount] = useState(0);

  // Refs for accessing state inside socket handlers
  const chatTargetRef = useRef(chatTarget);
  useEffect(() => { chatTargetRef.current = chatTarget; }, [chatTarget]);
  const selectedUserRef = useRef(selectedUser);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  const usersRef = useRef(users);
  useEffect(() => { usersRef.current = users; }, [users]);


  // 添加位置比较函数
  const isSamePosition = (pos1, pos2) => {
    if (!pos1 || !pos2) return false;
    return pos1.lng === pos2.lng && pos1.lat === pos2.lat;
  };

  // 更新位置的函数
  const updatePosition = (newPosition) => {
    if (!isSamePosition(position, newPosition)) {
      setPosition(newPosition);
      if (currentUser) {
        socket.emit('update_position', newPosition);
      }
    }
  };

  // 1. 获取初始位置 (在组件加载时运行)
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPosition({
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          addNotification('获取位置失败，将使用默认位置', 'error');
          setPosition({ lng: 116.404, lat: 39.915 }); // Default to Beijing
        }
      );
    } else {
      addNotification('浏览器不支持地理定位', 'error');
      setPosition({ lng: 116.404, lat: 39.915 }); // Default to Beijing
    }
  }, []); // 空依赖数组确保只运行一次

  // 2. 登录后持续更新位置
  useEffect(() => {
    if (currentUser && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const newPosition = {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
          };
          // 检查位置是否真的改变了
          if (position && (position.lat !== newPosition.lat || position.lng !== newPosition.lng)) {
            setPosition(newPosition);
            socket.emit('update_position', newPosition);
          }
        },
        (error) => {
          console.error("Error watching position:", error);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [currentUser, position]); // 当 currentUser 或 position 变化时触发

  // 3. 统一的 Socket.IO 事件监听
  useEffect(() => {
    const handleConnect = () => console.log('已连接到服务器, socket ID:', socket.id);
    const handleDisconnect = () => {
      console.log('与服务器断开连接');
      setCurrentUser(null);
      setUsers({});
      setChatTarget(null);
      setSelectedUser(null);
      addNotification('与服务器的连接已断开，请刷新页面重新连接。', 'error');
    };
    const handleUpdateUsers = (updatedUsers) => {
      console.log('Socket event: update_users', updatedUsers);
      setUsers(updatedUsers);
      setUserCount(Object.keys(updatedUsers).length);
    };
    const handleUserDisconnected = (data) => {
      console.log('用户断开连接:', data);
      addNotification(`${data.userName} 已离线`, 'info');
      if (chatTargetRef.current && chatTargetRef.current.id === data.userId) {
        setChatTarget(null);
      }
      if (selectedUserRef.current && selectedUserRef.current.id === data.userId) {
        setSelectedUser(null);
      }
    };
    const handlePrivateMessage = ({ from, sender_name, message, is_self }) => {
      console.log('收到私信:', { from, sender_name, message, is_self });
      const currentChatTarget = chatTargetRef.current;
      const targetId = from === socket.id ? currentChatTarget?.id : from;
      if (targetId) {
        setMessages((prev) => ({ ...prev, [targetId]: [...(prev[targetId] || []), { name: sender_name, text: message }] }));
        if (!is_self && (!currentChatTarget || currentChatTarget.id !== from)) {
          const sender = usersRef.current[from];
          if (sender) {
            addNotification(`收到来自 ${sender_name} 的新消息`, 'message', () => setChatTarget(sender), from);
          }
        }
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('update_users', handleUpdateUsers);
    socket.on('user_disconnected', handleUserDisconnected);
    socket.on('private_message', handlePrivateMessage);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('update_users', handleUpdateUsers);
      socket.off('user_disconnected', handleUserDisconnected);
      socket.off('private_message', handlePrivateMessage);
      
      // 清除所有通知定时器
      Object.values(notificationTimeoutsRef.current).forEach(timeout => {
        clearTimeout(timeout);
      });
    };
  }, []); // 空依赖数组确保只运行一次

  // 4. 处理登录
  const handleLogin = (e) => {
    e.preventDefault();
    const name = e.target.name.value;
    const contact = e.target.contact.value;
    const bio = e.target.bio.value;

    if (name && contact && position) {
      const userData = {
        name,
        contact,
        bio,
        avatar: selectedAvatar,
        position, // 使用已经获取到的位置
      };
      socket.emit('user_login', userData);
      setCurrentUser({ ...userData, id: socket.id });
    } else {
      addNotification('请填写所有信息并等待位置获取成功', 'error');
    }
  };

  const handleUpdateProfile = (e) => {
    e.preventDefault();
    const name = e.target.name.value;
    const contact = e.target.contact.value;
    const bio = e.target.bio.value;
    const updatedUser = {
      ...currentUser,
      name,
      contact,
      bio,
      avatar: selectedAvatar
    };
    setCurrentUser(updatedUser);
    socket.emit('user_login', updatedUser);
    setIsEditing(false);
  };

  const handleMarkerClick = (user) => {
    console.log('点击用户标记:', user);
    setSelectedUser(user);
  };

  const startChat = (user) => {
    setChatTarget(user);
    setSelectedUser(null); // Close info window when starting chat
    if (!messages[user.id]) {
      setMessages(prev => ({ ...prev, [user.id]: [] }));
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (inputValue.trim() && chatTarget) {
      console.log('发送消息:', { to: chatTarget.id, message: inputValue });
      socket.emit('private_message', { to: chatTarget.id, message: inputValue });
      setInputValue('');
    }
  };

  const UserForm = ({ onSubmit, initialData = {}, submitText }) => (
    <form onSubmit={onSubmit} className="user-form">
      <div className="avatar-selector">
        <h3>选择头像</h3>
        <div className="avatar-grid">
          {DEFAULT_AVATARS.map((avatar, index) => (
            <img
              key={index}
              src={avatar}
              alt={`Avatar ${index + 1}`}
              className={selectedAvatar === avatar ? 'selected' : ''}
              onClick={() => setSelectedAvatar(avatar)}
            />
          ))}
        </div>
      </div>
      <input
        type="text"
        name="name"
        placeholder="你的名字"
        required
        defaultValue={initialData.name || ''}
      />
      <input
        type="text"
        name="contact"
        placeholder="联系方式"
        required
        defaultValue={initialData.contact || ''}
      />
      <textarea
        name="bio"
        placeholder="个人简介"
        defaultValue={initialData.bio || ''}
      />
      <button type="submit" disabled={!position} className="button">
        {position ? submitText : '正在获取位置...'}
      </button>
    </form>
  );

  // 添加通知的函数
  const addNotification = (message, type = 'info', onClick = null, userId = null) => {
    const id = Date.now();
    const notification = {
      id,
      message,
      type,
      onClick: onClick ? (e) => {
        e.stopPropagation();
        onClick();
        // 点击后移除通知
        setNotifications(prev => prev.filter(n => n.id !== id));
        // 清除自动移除的定时器
        if (notificationTimeoutsRef.current[id]) {
          clearTimeout(notificationTimeoutsRef.current[id]);
          delete notificationTimeoutsRef.current[id];
        }
      } : null,
      userId
    };

    setNotifications(prev => {
      // 如果是消息通知，检查是否已经有来自同一用户的通知
      if (type === 'message' && userId) {
        // 移除同一用户的旧通知
        const filtered = prev.filter(n => n.userId !== userId);
        return [...filtered, notification];
      }
      return [...prev, notification];
    });

    // 存储定时器引用
    const timeoutId = setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
      delete notificationTimeoutsRef.current[id];
    }, 5000);
    notificationTimeoutsRef.current[id] = timeoutId;
  };

  // 添加地图加载完成的处理函数
  const handleMapLoaded = (map) => {
    setMap(map);
  };

  // 获取其他用户列表（不包括当前用户）
  const otherUsers = useMemo(() => {
    console.log("Recalculating otherUsers...");
    console.log("Current `users` state:", users);
    console.log("Current `currentUser` state:", currentUser);
    
    if (!currentUser || !currentUser.id) {
      console.log("No current user or user ID, returning empty list.");
      return [];
    }
    
    const filteredUsers = Object.values(users).filter(user => {
      const isCurrentUser = user.id === currentUser.id;
      return !isCurrentUser;
    });
    
    console.log("Filtered `otherUsers`:", filteredUsers);
    return filteredUsers;
  }, [users, currentUser]);

  // Effect to manage the Baidu Map InfoWindow
  useEffect(() => {
    // If an old info window exists, close it
    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }
    
    if (selectedUser && map && selectedUser.position) {
      // Make the startChat function available globally for the InfoWindow button
      window.startChat = (userId) => {
        const targetUser = users[userId];
        if (targetUser) {
          startChat(targetUser);
        }
      };
      
      const content = `
        <div class="user-info">
          <img src="${selectedUser.avatar}" alt="${selectedUser.name}" class="user-avatar" />
          <h3>${selectedUser.name}</h3>
          ${selectedUser.bio ? `<p class="user-bio">${selectedUser.bio}</p>` : ''}
          <p><strong>联系方式:</strong> ${selectedUser.contact}</p>
          <button onclick="window.startChat('${selectedUser.id}')" class="start-chat-button">
            开始聊天
          </button>
        </div>
      `;
      
      const point = new window.BMap.Point(selectedUser.position.lng, selectedUser.position.lat);
      const infoWindow = new window.BMap.InfoWindow(content, {
        width: 250,
        title: selectedUser.name
      });

      infoWindowRef.current = infoWindow;
      map.openInfoWindow(infoWindow, point);

      // Add listener to sync state when user closes the InfoWindow
      infoWindow.addEventListener('close', () => {
        if (selectedUser) { // Prevent race conditions
          setSelectedUser(null);
        }
      });
    }
  }, [selectedUser, map, users]); // `users` is needed for window.startChat to get the correct user object


  if (!currentUser) {
    return (
      <div className="login-container">
        <h2>登录</h2>
        <UserForm onSubmit={handleLogin} submitText="进入地图" />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 通知列表 */}
      <div className="notifications">
        {notifications.map(notification => (
          <div
            key={notification.id}
            className={`notification ${notification.type} ${notification.onClick ? 'clickable' : ''}`}
            onClick={notification.onClick}
          >
            {notification.message}
          </div>
        ))}
      </div>

      {/* 在线人数显示 */}
      <div className="user-count">
        当前在线: {userCount} 人
      </div>

      {/* 编辑个人信息按钮 */}
      <button className="edit-profile-button" onClick={() => setIsEditing(true)}>
        编辑个人信息
      </button>
      
      {/* 地图容器 */}
      <div className="map-container">
        <Map 
          ref={mapRef}
          zoom={15}
          center={position}
          enableScrollWheelZoom
          onTilesLoaded={(e) => handleMapLoaded(e.target)}
        >
          {/* 显示当前用户的标记 */}
          {map && position && currentUser && (
            <UserMarker
              user={currentUser}
              isCurrent={true}
              position={position}
              map={map}
            />
          )}
          
          {/* 显示其他用户的标记 */}
          {map && otherUsers.map((user) => (
            user.position && (
              <UserMarker
                key={user.id}
                user={user}
                position={user.position}
                onClick={() => handleMarkerClick(user)}
                map={map}
              />
            )
          ))}
        </Map>
      </div>
      
      {isEditing && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>编辑个人信息</h2>
            <UserForm
              onSubmit={handleUpdateProfile}
              initialData={currentUser}
              submitText="保存修改"
            />
            <button className="close-button" onClick={() => setIsEditing(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      
      {chatTarget && (
        <div className="chat-window">
          <div className="chat-header">
            <h3>与 {chatTarget.name} 的对话</h3>
            <button className="close-chat" onClick={() => setChatTarget(null)}>×</button>
          </div>
          <div className="messages">
            {(messages[chatTarget.id] || []).map((msg, index) => (
              <div key={index} className={`message ${msg.name === currentUser.name ? 'sent' : 'received'}`}>
                <b>{msg.name}: </b>{msg.text}
              </div>
            ))}
          </div>
          <form onSubmit={handleSendMessage}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入消息..."
            />
            <button type="submit">发送</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
