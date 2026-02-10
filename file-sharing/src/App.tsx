import React, { useEffect, useState, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'react-qr-code';
import { Scanner } from '@yudiel/react-qr-scanner';

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

const CHUNK_SIZE = 16 * 1024; // 16KB per chunk to prevent buffer overflow

export default function App() {
  // --- States ---
  const [myId, setMyId] = useState<string>('');
  const [targetIdInput, setTargetIdInput] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing...');
  const [progress, setProgress] = useState<number>(0); // 0-100
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [receivedFileUrl, setReceivedFileUrl] = useState<{ name: string; url: string } | null>(null);

  // --- Refs ---
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  // Buffer สำหรับพักข้อมูลไฟล์ขาเข้า
  const incomingFileBuffer = useRef<Array<ArrayBuffer>>([]);
  const incomingFileMeta = useRef<FileMeta | null>(null);
  const receivedSize = useRef<number>(0);

  // --- 1. Initialization ---
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

  // --- 2. Connection Logic ---
  const connectToPeer = (remoteId: string, peer: Peer) => {
    setStatus(`Connecting to ${remoteId}...`);
    const conn = peer.connect(remoteId);
    setupConnection(conn);
  };

  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;

    conn.on('open', () => {
      setStatus('Connected');
      setShowScanner(false); // Close scanner if open
    });

    conn.on('data', (data: unknown) => handleIncomingData(data as Packet));

    conn.on('close', () => {
      setStatus('Connection closed');
      connRef.current = null;
      resetTransferState();
    });
  };

  const resetTransferState = () => {
    setProgress(0);
    incomingFileBuffer.current = [];
    incomingFileMeta.current = null;
    receivedSize.current = 0;
  };

  // --- 3. Receive Logic (Handling Chunks) ---
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

      // คำนวณ Progress ขาบ
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

  // --- 4. Send Logic (Chunking) ---
  const sendFile = async (file: File) => {
    if (!connRef.current) return;

    setStatus(`Sending ${file.name}...`);
    setProgress(0);

    // 4.1 Send Metadata
    connRef.current.send({
      type: 'META',
      payload: { name: file.name, size: file.size, type: file.type }
    } as Packet);

    // 4.2 Loop Send Chunks
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      connRef.current.send({
        type: 'CHUNK',
        payload: { data: buffer, offset }
      } as Packet);

      offset += buffer.byteLength;
      setProgress(Math.round((offset / file.size) * 100));

      // Trick: รอเล็กน้อยเพื่อให้ Event Loop ทำงาน (ป้องกัน UI ค้าง)
      await new Promise(r => setTimeout(r, 0));
    }

    // 4.3 Send End Signal
    connRef.current.send({ type: 'END', payload: null } as Packet);
    setStatus('Sent successfully!');
  };

  // --- 5. UI Handlers ---
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
    if (connRef.current && e.dataTransfer.files?.[0]) {
      sendFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // จำเป็นต้องมีเพื่อให้ Drop ได้
  };

  const handleScanResult = (result: any) => {
    // Library นี้จะส่งค่ามาเป็น Array ให้เอาตัวแรก
    const rawValue = result?.[0]?.rawValue;
    if (rawValue) {
      // ... logic เดิม ...
      // เช่นเช็คว่าเป็น URL หรือ ID 4 ตัว
      try {
        const url = new URL(rawValue);
        const rid = url.searchParams.get('remoteId');
        if (rid && peerRef.current) connectToPeer(rid, peerRef.current);
      } catch {
        if (rawValue && peerRef.current) connectToPeer(rawValue, peerRef.current);
      }
    }
  };

  // Helpers
  const generateShortId = () => {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
  };

  const shareUrl = `${window.location.href.split('?')[0]}?remoteId=${myId}`;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      style={{ minHeight: '100vh', padding: 20, border: '2px dashed #ccc' }} // Drag Zone
    >
      <h2>P2P File Drop (Chunked)</h2>
      <p>ID: <strong>{myId}</strong> | Status: <strong>{status}</strong></p>

      {/* Progress Bar */}
      {progress > 0 && (
        <div style={{ width: '100%', background: '#eee', height: 20, margin: '10px 0' }}>
          <div style={{ width: `${progress}%`, background: 'green', height: '100%', transition: 'width 0.2s' }} />
          <span style={{ fontSize: 12 }}>{progress}%</span>
        </div>
      )}

      {/* Connection UI */}
      {!connRef.current && (
        <div style={{ marginTop: 20 }}>
          {/* 4-Digit Input */}
          <input
            placeholder="Enter 4-Digit Code"
            value={targetIdInput}
            onChange={handleIdInput}
            style={{ fontSize: 20, letterSpacing: 5, width: 150, textTransform: 'uppercase' }}
          />

          <div style={{ margin: '20px 0' }}>OR</div>

          {/* QR Scanner */}
          <button onClick={() => setShowScanner(!showScanner)}>
            {showScanner ? 'Close Scanner' : 'Scan QR to Connect'}
          </button>

          {showScanner && (
            <div style={{ width: 300, margin: '10px auto' }}>
              {/* 3. เรียกใช้ Component ใหม่ */}
              <Scanner
                onScan={handleScanResult}
                // ปิดเสียง beep ตอนสแกนได้ถ้าต้องการ
                allowMultiple={true}
                scanDelay={2000}
              />
            </div>
          )}

          {/* QR Display */}
          <div style={{ marginTop: 20 }}>
            <QRCode value={shareUrl} size={120} />
            <p><small>{shareUrl}</small></p>
          </div>
        </div>
      )}

      {/* File Transfer UI */}
      {connRef.current && (
        <div style={{ marginTop: 40 }}>
          <h3>Drag & Drop files here or</h3>
          <input type="file" onChange={handleFileSelect} />

          {receivedFileUrl && (
            <div style={{ marginTop: 20, padding: 10, background: '#d4edda' }}>
              <p>File Ready: {receivedFileUrl.name}</p>
              <a href={receivedFileUrl.url} download={receivedFileUrl.name}>Download</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}