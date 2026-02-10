import React, { useEffect, useState, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'react-qr-code';

// กำหนด Type ของข้อมูลที่เราจะส่งหากัน
interface FilePayload {
  dataType: 'FILE';
  fileName: string;
  fileType: string;
  fileData: ArrayBuffer; // PeerJS ส่งข้อมูลเป็น ArrayBuffer
}

// กำหนด Type ของไฟล์ที่ได้รับมา (แปลงเป็น Blob Url แล้ว)
interface ReceivedFile {
  fileName: string;
  url: string;
}

export default function App() {
  const [myId, setMyId] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing...');
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null);

  // ใช้ useRef เก็บ connection เพื่อไม่ให้หลุดตอน Re-render
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  useEffect(() => {
    // 1. สร้าง Identity ของเครื่องเรา
    const peer = new Peer();

    peer.on('open', (id) => {
      setMyId(id);
      setStatus('Waiting for connection...');

      // 2. เช็คว่าเราเข้ามาผ่าน QR Code หรือไม่? (Auto Connect Logic)
      // URL Pattern: http://host/?remoteId=XXX
      const params = new URLSearchParams(window.location.search);
      const remoteId = params.get('remoteId');

      if (remoteId) {
        connectToPeer(remoteId, peer);
      }
    });

    // 3. (ฝั่ง PC) รอรับการเชื่อมต่อจาก Mobile
    peer.on('connection', (conn) => {
      setupConnection(conn);
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
    };
  }, []);

  // ฟังก์ชันเริ่มเชื่อมต่อ (Active Connection)
  const connectToPeer = (remoteId: string, peer: Peer) => {
    setStatus(`Connecting to ${remoteId}...`);
    const conn = peer.connect(remoteId);
    setupConnection(conn);
  };

  // ฟังก์ชันจัดการ Events เมื่อเชื่อมต่อสำเร็จ (ใช้ได้ทั้งสองฝั่ง)
  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;

    conn.on('open', () => {
      setStatus(`Connected! Ready to transfer.`);
    });

    conn.on('data', (data: unknown) => {
      // ตรวจสอบ Type ข้อมูลก่อนใช้งาน (Type Guard)
      const payload = data as FilePayload;

      if (payload.dataType === 'FILE') {
        // แปลง ArrayBuffer กลับเป็น Blob
        const blob = new Blob([payload.fileData], { type: payload.fileType });
        const url = URL.createObjectURL(blob);

        // อัปเดต State เพื่อโชว์ปุ่ม Download
        setReceivedFile({
          fileName: payload.fileName,
          url: url
        });

        setStatus(`Received file: ${payload.fileName}`);
      }
    });

    conn.on('close', () => {
      setStatus('Connection closed');
      connRef.current = null;
    });

    conn.on('error', (err) => {
      console.error(err);
      setStatus('Connection Error');
    });
  };

  // ฟังก์ชันส่งไฟล์
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !connRef.current) return;

    setStatus(`Sending ${file.name}...`);

    // อ่านไฟล์เป็น ArrayBuffer เพื่อส่งผ่าน WebRTC
    const arrayBuffer = await file.arrayBuffer();

    const payload: FilePayload = {
      dataType: 'FILE',
      fileName: file.name,
      fileType: file.type,
      fileData: arrayBuffer
    };

    connRef.current.send(payload);
    setStatus(`Sent ${file.name} successfully!`);
  };

  // สร้าง URL สำหรับ QR Code (ใช้ IP เครื่องจริง หรือ Domain จริงในการ Deploy)
  // หมายเหตุ: ถ้า Test localhost บน PC, มือถือจะเข้าไม่ได้ ต้องใช้ IP LAN (เช่น 192.168.x.x)
  const shareUrl = `${window.location.href.split('?')[0]}?remoteId=${myId}`;

  return (
    <>
      <div style={{ position: 'fixed', bottom: '0px', textAlign: 'center', width: '100vw' }}>
        <p>version: v1.0.0 DEMO</p>
      </div>
      <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
        <h2>P2P File Drop</h2>

        {/* Status Bar */}
        <div style={{ padding: '10px', background: '#e0e0e0', borderRadius: '8px', marginBottom: '20px' }}>
          <strong>Status:</strong> {status}
        </div>

        {/* SENDER UI (PC): แสดง QR Code ก็ต่อเมื่อยังไม่ได้เชื่อมต่อ 
        และเราไม่ใช่คนที่กดเข้ามาผ่าน Link (ไม่มี remoteId ใน URL)
      */}
        {!connRef.current && !window.location.search.includes('remoteId') && myId && (
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <p>Scan with Mobile to Connect:</p>
            <div style={{ background: 'white', padding: '16px', display: 'inline-block', border: '1px solid #ddd' }}>
              <QRCode value={shareUrl} size={150} />
            </div>
            <p style={{ fontSize: '0.8rem', color: '#666', wordBreak: 'break-all' }}>
              {shareUrl}
            </p>
          </div>
        )}

        {/* FILE TRANSFER UI: แสดงเมื่อเชื่อมต่อแล้ว */}
        {status.includes('Connected') || status.includes('Sent') || status.includes('Received') ? (
          <div style={{ border: '2px dashed #ccc', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>

            {/* ส่วนส่งไฟล์ */}
            <div style={{ marginBottom: '20px' }}>
              <h4>Send File</h4>
              <input type="file" onChange={handleFileChange} />
            </div>

            <hr style={{ margin: '20px 0' }} />

            {/* ส่วนรับไฟล์ (แสดงปุ่ม Download) */}
            {receivedFile && (
              <div style={{ background: '#d4edda', padding: '15px', borderRadius: '8px', color: '#155724' }}>
                <h4>New File Received!</h4>
                <p>{receivedFile.fileName}</p>
                <a
                  href={receivedFile.url}
                  download={receivedFile.fileName}
                  style={{
                    background: '#28a745', color: 'white', padding: '10px 20px',
                    textDecoration: 'none', borderRadius: '5px', display: 'inline-block'
                  }}
                >
                  Tap to Download
                </a>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}