import React, { useEffect, useState, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'react-qr-code';
import { Scanner } from '@yudiel/react-qr-scanner';
import './App.css';

// --- Types ---
type PacketType = 'META' | 'CHUNK' | 'END';

interface Packet {
  type: PacketType;
  payload: any;
}

interface FileMeta {
  name: string;
  size: number;
  type: string;
}

interface FileChunk {
  data: ArrayBuffer;
  offset: number;
}

// 🚀 ปรับขนาด Chunk ให้ใหญ่ขึ้นเพื่อความเร็ว (64KB is sweet spot for WebRTC)
const CHUNK_SIZE = 64 * 1024;

export default function App() {
  // --- States ---
  const [myId, setMyId] = useState<string>('');
  const [targetIdInput, setTargetIdInput] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing...');
  const [progress, setProgress] = useState<number>(0); // 0-100
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [receivedFileUrl, setReceivedFileUrl] = useState<{ name: string; url: string } | null>(null);

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // --- Refs ---
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // Buffer สำหรับพักข้อมูลไฟล์ขาเข้า
  const incomingFileBuffer = useRef<Array<ArrayBuffer>>([]);
  const incomingFileMeta = useRef<FileMeta | null>(null);
  const receivedSize = useRef<number>(0);

  // --- Theme Toggle Logic ---
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // --- Helpers ---
  const generateShortId = () => {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
  };

  // --- Initialization ---
  useEffect(() => {
    const myCustomId = generateShortId();
    const peer = new Peer(myCustomId);

    peer.on('open', (id) => {
      setMyId(id);
      setStatus('Waiting for connection...');
      const params = new URLSearchParams(window.location.search);
      const remoteId = params.get('remoteId');
      if (remoteId) connectToPeer(remoteId, peer);
    });

    peer.on('connection', (conn) => setupConnection(conn));

    // Handle manual ID collision error
    peer.on('error', (err: any) => {
      if (err.type === 'unavailable-id') window.location.reload();
    });

    peerRef.current = peer;
    return () => peer.destroy();
  }, []);

  // --- Connection Logic ---
  const connectToPeer = (remoteId: string, peer: Peer) => {
    setStatus(`Connecting to ${remoteId}...`);
    const conn = peer.connect(remoteId);
    setupConnection(conn);
  };

  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;
    conn.on('open', () => {
      setStatus('Connected');
      setShowScanner(false);
    });
    conn.on('data', (data: unknown) => handleIncomingData(data as Packet));
    conn.on('close', () => {
      setStatus('Disconnected');
      connRef.current = null;
      resetTransferState();
    });
    // เพิ่มการดัก Error ของ Connection ด้วย
    conn.on('error', (err) => {
      console.error("Connection Error:", err);
      setStatus('Transfer Error');
    });
  };

  const resetTransferState = () => {
    setProgress(0);
    incomingFileBuffer.current = [];
    incomingFileMeta.current = null;
    receivedSize.current = 0;
  };

  // --- Receive Logic ---
  const handleIncomingData = (packet: Packet) => {
    if (packet.type === 'META') {
      // เริ่มต้นรับไฟล์ใหม่
      resetTransferState();
      incomingFileMeta.current = packet.payload as FileMeta;
      setStatus(`Receiving: ${incomingFileMeta.current.name}`);
    }
    else if (packet.type === 'CHUNK') {
      // รับชิ้นส่วนไฟล์
      const chunk = packet.payload as FileChunk;
      incomingFileBuffer.current.push(chunk.data);
      receivedSize.current += chunk.data.byteLength;

      // คำนวณ Progress
      if (incomingFileMeta.current) {
        const pct = Math.round((receivedSize.current / incomingFileMeta.current.size) * 100);
        setProgress(pct);
      }
    }
    else if (packet.type === 'END') {
      // จบการรับไฟล์ -> ประกอบร่าง
      if (incomingFileMeta.current) {
        const blob = new Blob(incomingFileBuffer.current, { type: incomingFileMeta.current.type });
        const url = URL.createObjectURL(blob);
        setReceivedFileUrl({ name: incomingFileMeta.current.name, url });
        setStatus('File received completely!');
      }
    }
  };

  // --- 🚀 Send Logic (Fixed with Backpressure) ---
  const sendFile = async (file: File) => {
    if (!connRef.current) return;

    setStatus(`Sending ${file.name}...`);
    setProgress(0);

    // 1. Send Metadata
    connRef.current.send({
      type: 'META',
      payload: { name: file.name, size: file.size, type: file.type }
    } as Packet);

    // 2. Loop Send Chunks with Flow Control
    let offset = 0;

    // เข้าถึง DataChannel เพื่อเช็ค Buffer (ต้อง Cast type นิดหน่อย)
    const dataChannel = (connRef.current as any).dataChannel as RTCDataChannel;

    while (offset < file.size) {
      // เช็คว่า Buffer เต็มหรือไม่? (Backpressure)
      // ถ้า buffer เกิน 64KB ให้รอก่อน อย่าเพิ่งยัดเพิ่ม
      if (dataChannel.bufferedAmount > 64 * 1024) {
        await new Promise(r => setTimeout(r, 10)); // รอ 10ms แล้วเช็คใหม่
        continue; // วนลูปกลับไปเช็คใหม่
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      connRef.current.send({
        type: 'CHUNK',
        payload: { data: buffer, offset }
      } as Packet);

      offset += buffer.byteLength;
      setProgress(Math.round((offset / file.size) * 100));

      // แต่ใส่ไว้นิดนึงเพื่อให้ UI ไม่ค้างถ้าเครื่องเร็วจัด
      if (offset % (CHUNK_SIZE * 5) === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 3. Send End Signal
    // รอให้ Buffer ว่างจริงๆ ก่อนส่ง END เพื่อให้แน่ใจว่า Chunk สุดท้ายไปถึงก่อน
    while (dataChannel.bufferedAmount > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    connRef.current.send({ type: 'END', payload: null } as Packet);
    setStatus('Sent successfully!');
  };

  // --- Handlers ---
  const handleIdInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().slice(0, 4); // Limit 4 chars
    setTargetIdInput(val);

    // Auto Connect เมื่อครบ 4 ตัว
    if (val.length === 4 && peerRef.current) {
      connectToPeer(val, peerRef.current);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) sendFile(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (connRef.current && e.dataTransfer.files?.[0]) sendFile(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleScanResult = (result: any) => {
    const rawValue = result?.[0]?.rawValue;
    if (rawValue) {
      try {
        const url = new URL(rawValue);
        const rid = url.searchParams.get('remoteId');
        if (rid && peerRef.current) connectToPeer(rid, peerRef.current);
      } catch {
        if (rawValue && peerRef.current) connectToPeer(rawValue, peerRef.current);
      }
    }
  };

  const shareUrl = `${window.location.href.split('?')[0]}?remoteId=${myId}`;

  return (
    <div
      className={`app-container ${isDragging ? 'dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Full Screen Drag Overlay */}
      <div className="drag-overlay">
        <span>Drop file to send! 🚀</span>
      </div>

      <div className="status-text" style={{ position: 'fixed', bottom: '0', right: '0.5rem' }}>
        v1.2.1
      </div>

      <div className="glass-card">
        {/* Header */}
        <div className="header">
          <div className="status-text">
            <h2>Quick File</h2>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="theme-toggle"
              title="Support Me"
              onClick={() => window.open('https://nobpasintumdee.github.io/MyPortfolio/#/contact', '_blank')}
            >
              🍵
            </button>
            <button
              className="theme-toggle"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title="Toggle Theme"
            >
              {isDarkMode ? '🌙' : '☀️'}
            </button>
          </div>
        </div>

        <div className='glass-container'>
          <div className='glass-subcontainer1'>

            {/* --- STATE 1: Not Connected --- */}
            <div className="connect-section">
              {!showScanner ? (
                <>
                  {/* ID & Status */}
                  <div className="status-badge">
                    <div className="id-display">{myId || '....'}</div>
                  </div>
                  <input
                    className="code-input"
                    placeholder="CODE"
                    value={targetIdInput}
                    onChange={handleIdInput}
                  />

                  {/* QR Display */}
                  <div className="qr-frame">
                    <QRCode value={shareUrl} />
                  </div>
                  <div className="status-text">
                    {status} Lorem ipsum dolor sit amet, consectetur adipisicing elit. Voluptas, autem.
                  </div>
                  <button className="btn-secondary" onClick={() => setShowScanner(true)}>
                    Scan QR Code
                  </button>
                </>
              ) : (
                <div style={{ width: '100%', borderRadius: '12px', overflow: 'hidden', alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
                  <Scanner onScan={handleScanResult} allowMultiple={true} />
                  <button
                    className="btn-secondary"
                    style={{ marginTop: 10 }}
                    onClick={() => setShowScanner(false)}
                  >
                    Close Camera
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className='glass-subcontainer2'>
            {/* Progress Bar */}
            {progress > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 5 }}>
                  <span>Transferring...</span>
                  <span>{progress}%</span>
                </div>
                <div className="progress-container">
                  <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            {/* --- STATE 2: Connected --- */}
            {connRef.current && (
              <div className="transfer-section">
                <label className="file-drop-area file-label">
                  <span className="icon-upload">☁️</span>
                  <p><strong>Click to upload</strong> or Drag & Drop</p>
                  <input type="file" onChange={handleFileSelect} className="file-input-hidden" />
                </label>

                {receivedFileUrl && (
                  <div className="download-card">
                    <h3>📦 File Received!</h3>
                    <p style={{ wordBreak: 'break-all', fontSize: '0.9rem' }}>{receivedFileUrl.name}</p>
                    <a href={receivedFileUrl.url} download={receivedFileUrl.name} className="download-btn">
                      Download Now
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}