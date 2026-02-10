import React, { useEffect, useState, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'react-qr-code';

// กำหนด Type ของข้อมูลที่เราจะส่งหากัน
interface FilePayload {
  dataType: 'FILE';
  fileName: string;
  fileType: string;
  fileData: ArrayBuffer;
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

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);

  useEffect(() => {
    let myCustomId = generateShortId();
    const peer = new Peer(myCustomId);

    peer.on('open', (id) => {
      setMyId(id);
      setStatus('Waiting for connection...');

      // URL Pattern: http://host/?remoteId=XXX
      const params = new URLSearchParams(window.location.search);
      const remoteId = params.get('remoteId');

      if (remoteId) {
        connectToPeer(remoteId, peer);
      }
    });

    peer.on('connection', (conn) => {
      setupConnection(conn);
    });

    peerRef.current = peer;

    return () => {
      peer.destroy();
    };
  }, []);

  const connectToPeer = (remoteId: string, peer: Peer) => {
    setStatus(`Connecting to ${remoteId}...`);
    const conn = peer.connect(remoteId);
    setupConnection(conn);
  };

  const setupConnection = (conn: DataConnection) => {
    connRef.current = conn;

    conn.on('open', () => {
      setStatus(`Connected! Ready to transfer.`);
    });

    conn.on('data', (data: unknown) => {
      // Type Guard
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

  // function send file data via WebRTC
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


  const generateShortId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const shareUrl = `${window.location.href.split('?')[0]}?remoteId=${myId}`;

  return (
    <>
      <div style={{ position: 'fixed', bottom: '0px', textAlign: 'center', width: '100vw' }}>
        <p>version: v1.0.0 DEMO</p>
      </div>
      <div>
        <h2>P2P File Drop</h2>

        {/* Status Bar */}
        <div>
          <strong>Status:</strong> {status}
        </div>

        {!connRef.current && !window.location.search.includes('remoteId') && myId && (
          <div>
            <p>Scan with Mobile to Connect:</p>
            <div>
              <QRCode value={shareUrl} size={150} />
            </div>
            <p>
              {shareUrl}
            </p>
          </div>
        )}

        {status.includes('Connected') || status.includes('Sent') || status.includes('Received') ? (
          <div>

            <div>
              <h4>Send File</h4>
              <input type="file" onChange={handleFileChange} />
            </div>

            <hr />

            {/* Download */}
            {receivedFile && (
              <div>
                <h4>New File Received!</h4>
                <p>{receivedFile.fileName}</p>
                <a
                  href={receivedFile.url}
                  download={receivedFile.fileName}
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