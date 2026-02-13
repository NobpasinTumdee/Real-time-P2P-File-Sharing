import React, { useEffect, useState, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import QRCode from 'react-qr-code';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';

import { MdDarkMode } from "react-icons/md";
import { FiDownload, FiSun } from "react-icons/fi";
import { LiaDonateSolid } from "react-icons/lia";
import { FaCheck, FaRegLightbulb } from "react-icons/fa";
import { LuCopy, LuCopyCheck, LuLink } from "react-icons/lu";


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
  const { t, i18n } = useTranslation();
  // --- States ---
  const [myId, setMyId] = useState<string>('');
  const [targetIdInput, setTargetIdInput] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing...');
  const [progress, setProgress] = useState<number>(0); // 0-100
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [receivedFiles, setReceivedFiles] = useState<Array<{ name: string; url: string; type: string; time: string }>>([]);

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // --- Refs ---
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  // Buffer
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
      message.success('Welcome! Your ID: ' + id);
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
    // reliable: true  Reliable mode is (TCP protocol)
    const conn = peer.connect(remoteId, {
      reliable: true
    });
    setupConnection(conn);
  };
  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;
    conn.on('open', () => {
      message.success('Connected');
      setStatus('Connected');
      setShowScanner(false);
      const audio = new Audio('/applepay.mp3');
      audio.play().catch(e => console.log("Audio play failed", e));
    });
    conn.on('data', (data: unknown) => handleIncomingData(data as Packet));
    conn.on('close', () => {
      message.info('Disconnected');
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
        const time = (new Date()).toLocaleTimeString();
        const blob = new Blob(incomingFileBuffer.current, { type: incomingFileMeta.current.type });
        const url = URL.createObjectURL(blob);

        // Create new Object 
        const newFile = { name: incomingFileMeta.current.name, url: url, type: incomingFileMeta.current.type, time: time };

        // append to list
        setReceivedFiles(prev => [newFile, ...prev]);

        setStatus('File received completely!');
        message.success('File received successfully!');
        const audio = new Audio('/steam-achievement.mp3');
        audio.play().catch(e => console.log("Audio play failed", e));
      }
    }
  };

  // --- Send via TCP Logic ---
  const sendFileTCP = async (file: File) => {
    if (!connRef.current) return;

    setStatus(`Sending ${file.name}...`);
    setProgress(0);

    const dataChannel = (connRef.current as any).dataChannel as RTCDataChannel;

    // 1. Send Metadata
    connRef.current.send({
      type: 'META',
      payload: { name: file.name, size: file.size, type: file.type }
    } as Packet);

    let offset = 0;

    while (offset < file.size) {
      // ถ้า buffer เกินขีดจำกัด ให้ "หยุดรอ" (await) จนกว่าจะว่าง
      while (dataChannel.bufferedAmount > CHUNK_SIZE) {
        await new Promise(r => setTimeout(r, 5));
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      connRef.current.send({
        type: 'CHUNK',
        payload: { data: buffer, offset }
      } as Packet);

      offset += buffer.byteLength;
      setProgress(Math.round((offset / file.size) * 100));
    }

    // รอจนกว่าข้อมูลชิ้นสุดท้ายจะออกจาก Buffer จริงๆ
    while (dataChannel.bufferedAmount > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    connRef.current.send({ type: 'END', payload: null } as Packet);
    const audio = new Audio('/steam-achievement.mp3');
    audio.play().catch(e => console.log("Audio play failed", e));
    setStatus('Sent successfully!');
    message.success('File sent successfully!');
  };

  // --- Send via UDP Logic ---
  const sendFileUDP = async (file: File) => {
    if (!connRef.current) return;

    setStatus(`Sending ${file.name}...`);
    setProgress(0);

    connRef.current.send({
      type: 'META',
      payload: { name: file.name, size: file.size, type: file.type }
    } as Packet);

    let offset = 0;

    const dataChannel = (connRef.current as any).dataChannel as RTCDataChannel;

    while (offset < file.size) {
      if (dataChannel.bufferedAmount > 64 * 1024) {
        await new Promise(r => setTimeout(r, 10));
        continue;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();

      connRef.current.send({
        type: 'CHUNK',
        payload: { data: buffer, offset }
      } as Packet);

      offset += buffer.byteLength;
      setProgress(Math.round((offset / file.size) * 100));

      if (offset % (CHUNK_SIZE * 5) === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    while (dataChannel.bufferedAmount > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    connRef.current.send({ type: 'END', payload: null } as Packet);
    const audio = new Audio('/steam-achievement.mp3');
    audio.play().catch(e => console.log("Audio play failed", e));
    setStatus('Sent successfully!');
    message.success('File sent successfully!');
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

  const handleFileSelectSlowUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) sendFileTCP(e.target.files[0]);
  };
  const handleFileSelectFastUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) sendFileUDP(e.target.files[0]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (connRef.current && e.dataTransfer.files?.[0]) sendFileTCP(e.dataTransfer.files[0]);
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

  // --- copy ---
  const [copySuccess, setCopySuccess] = useState(false);
  const handleCopy = async (context: string) => {
    try {
      await navigator.clipboard.writeText(context);
      message.success('Link copied to clipboard!', 2);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // --- Save file ---
  const handleDownload = async (fileUrl: string, fileName: string) => {
    // เช็คว่าเป็นแอปมือถือหรือไม่? (Android/iOS)
    if (Capacitor.isNativePlatform()) {
      // --- Logic สำหรับ Mobile (บันทึกลงเครื่อง) ---
      try {
        message.loading('Saving to device...', 1);
        const response = await fetch(fileUrl);
        const blob = await response.blob();

        // แปลง Blob เป็น Base64
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];

          try {
            const savedFile = await Filesystem.writeFile({
              path: fileName,
              data: base64data,
              directory: Directory.Documents,
            });
            message.success('Saved to Documents folder!');
            console.log('Saved to:', savedFile.uri);
          } catch (err) {
            message.error('Save failed on device');
          }
        };
      } catch (e) {
        message.error('Error processing file');
      }

    } else {
      // --- Logic สำหรับ Web (สร้าง Link กดโหลดอัตโนมัติ) ---
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success('Download started');
    }
  };

  return (
    <div
      className={`app-container ${isDragging ? 'dragging' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Full Screen Drag Overlay */}
      <div className="drag-overlay">
        <span>{t('Drop_file')} 🚀</span>
      </div>

      <div className="status-text" style={{ position: 'fixed', bottom: '0', right: '0.5rem' }}>
        v1.4.0
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
              onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'th' : 'en')}
              title="Change Language"
            >
              {i18n.language === 'en' ? <img src="/flag/en.png" alt="English Flag" style={{ width: '1.5rem' }} /> : <img src="/flag/th.png" alt="Thai Flag" style={{ width: '1.5rem' }} />}
            </button>
            <button
              className="theme-toggle"
              title="Support Me"
              onClick={() => window.open('https://nobpasintumdee.github.io/MyPortfolio/#/contact', '_blank')}
            >
              <LiaDonateSolid />
            </button>
            <button
              className="theme-toggle dark-mode-icon"
              onClick={() => setIsDarkMode(!isDarkMode)}
              title="Toggle Theme"
            >
              {isDarkMode ? <FiSun /> : <MdDarkMode />}
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
                    <div className="id-display" onClick={() => handleCopy(myId)}>{myId || '....'}</div>
                    {myId && (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <button className="btn-copy" onClick={() => handleCopy(myId)}>
                          {copySuccess ? <LuCopyCheck /> : <LuCopy />}
                        </button>
                        <button className="btn-copy" onClick={() => handleCopy(shareUrl)}>
                          {copySuccess ? <FaCheck /> : <LuLink />}
                        </button>
                      </div>
                    )}
                  </div>
                  <input
                    className="code-input"
                    placeholder="CODE"
                    value={targetIdInput}
                    onChange={handleIdInput}
                  />

                  {/* QR Display */}
                  <div className="qr-frame" style={{ filter: `${myId ? 'blur(0px)' : 'blur(10px)'}` }}>
                    <QRCode value={shareUrl} bgColor='transparent' fgColor='var(--primary)' title={shareUrl} level='L' />
                  </div>
                  <div className="status-text">
                    {status}
                  </div>
                  <button className="btn-secondary" onClick={() => setShowScanner(true)}>
                    {t('QR_scanner')}
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
                    {t('close_camera')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className='glass-subcontainer2'>
            {/* --- STATE 2: Connected --- */}
            {connRef.current ? (
              <div className="transfer-section">
                <div style={{ display: 'flex', width: '100%', gap: '1rem', justifyContent: 'center' }}>
                  <label className="file-drop-area file-label">
                    <span className="icon-upload">🐢</span>
                    <p className='p-label'><strong>{t('p-label-tcp-strong')}</strong>{t('p-label-tcp')}</p>
                    <p className='sub-p-label'>{t('sub-p-label-tcp')}</p>
                    <input type="file" onChange={handleFileSelectSlowUpload} className="file-input-hidden" />
                  </label>
                  <label className="file-drop-area file-label not-recommended">
                    <span className="icon-upload">⚡</span>
                    <p className='p-label'><strong>{t('p-label-udp-strong')}</strong>{t('p-label-udp')}</p>
                    <p className='sub-p-label'>{t('sub-p-label-udp')}</p>
                    <input type="file" onChange={handleFileSelectFastUpload} className="file-input-hidden" />
                  </label>
                </div>

                {/* Progress Bar */}
                {progress > 0 && (
                  <div style={{ margin: '10px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 5 }}>
                      <span>{progress === 100 ? 'Transfer Completed' : 'Transfering...'}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="progress-container">
                      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                )}

                {receivedFiles.length > 0 && (
                  <div style={{ marginTop: '20px', width: '100%' }}>
                    <h3 style={{ color: 'var(--primary)', marginBottom: '10px' }}>
                      📦 {t('received')} ({receivedFiles.length})
                    </h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {receivedFiles.map((file, index) => {
                        const isImage = file.type.startsWith('image/');
                        const isVideo = file.type.startsWith('video/');

                        return (
                          <div key={index} className="download-card" style={{ marginTop: 0, animationDelay: `${index * 0.1}s` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                                {isImage ? (
                                  // 🖼️ Picture Preview
                                  <img
                                    src={file.url}
                                    alt="preview"
                                    style={{
                                      width: '48px',
                                      height: '48px',
                                      objectFit: 'cover',
                                      borderRadius: '8px',
                                      marginRight: '12px',
                                      border: '1px solid var(--border-color)',
                                      backgroundColor: '#fff'
                                    }}
                                  />
                                ) : isVideo ? (
                                  // 🎬 Video
                                  <span style={{ fontSize: '2rem', marginRight: '12px' }}>🎬</span>
                                ) : (
                                  // 📄 (PDF, Zip etc)
                                  <span style={{ fontSize: '2rem', marginRight: '12px' }}>📄</span>
                                )}
                                <div style={{ textAlign: 'left' }}>
                                  <span style={{ wordBreak: 'break-all', fontSize: '0.9rem', fontWeight: 'bold', display: 'block' }}>
                                    {file.name}
                                  </span>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{file.type} • {file.time}</span>
                                </div>
                              </div>

                              {/* <a
                                href={file.url}
                                download={file.name}
                                className="download-btn"
                                style={{ padding: '8px 16px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                              >
                                <FiDownload />
                              </a> */}
                              <div
                                onClick={() => handleDownload(file.url, file.name)}
                                className="download-btn"
                                style={{ padding: '8px 16px', fontSize: '0.8rem', whiteSpace: 'nowrap', cursor: 'pointer' }}
                              >
                                <FiDownload />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Clear History */}
                    <button
                      onClick={() => setReceivedFiles([])}
                      style={{
                        marginTop: '15px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        textDecoration: 'underline'
                      }}
                    >
                      {t('clear')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="guide-card">
                <div className="guide-title">
                  <span><FaRegLightbulb /></span> {t('guide-title')}
                </div>

                {/* Step 1 */}
                <div className="guide-step">
                  <div className="step-number">1</div>
                  <div>
                    <strong>{t('guide-step-1-title')}:</strong><br />
                    {t('guide-step-1')}<br />
                    <small style={{ color: 'var(--text-muted)' }}>{t('guide-step-1-small')}</small>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="guide-step">
                  <div className="step-number">2</div>
                  <div>
                    <strong>{t('guide-step-2-title')}:</strong><br />
                    {t('guide-step-2')}
                  </div>
                </div>

                {/* Step 3 - Detailed Protocol Explanation */}
                <div className="guide-step" style={{ alignItems: 'flex-start' }}>
                  <div className="step-number">3</div>
                  <div>
                    <strong>{t('guide-step-3-title')}:</strong><br />
                    <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>

                      {/* TCP Explanation */}
                      <div style={{ marginBottom: '10px' }}>
                        <span style={{ fontWeight: 'bold', color: '#2cab7c' }}>🐢 {t('guide-step-3-title-tcp')}</span>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: 'var(--text-muted)' }}>
                          <li><b>{t('pros')}:</b> {t('guide-step-3-title-tcp-1')}</li>
                          <li><b>{t('cons')}:</b> {t('guide-step-3-title-tcp-2')}</li>
                        </ul>
                      </div>

                      {/* UDP Explanation */}
                      <div>
                        <span style={{ fontWeight: 'bold', color: '#f59e0b' }}>⚡ {t('guide-step-3-title-udp')}</span>
                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: 'var(--text-muted)' }}>
                          <li><b>{t('pros')}:</b> {t('guide-step-3-title-udp-1')}</li>
                          <li><b>{t('cons')}:</b> {t('guide-step-3-title-udp-2')}</li>
                        </ul>
                      </div>

                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}