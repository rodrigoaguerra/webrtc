import { useEffect, useState } from 'react';
import { Box, styled } from '@mui/material';

const TransferWrapper = styled(Box)(() => ({
  display: 'flex',
  width: '100%',
  gap: 0 /* sem gap pra não estourar */
}));

export default function TransferComponent({
  sendQueue,
  receiveQueue,
  sendCountText,
  receiveCountText,
  showSendConfirm,
  showAcceptConfirm,
  totalSendSize,
  totalReceiveSize,
  acceptBtnText,
  acceptDisabled,
  receiveAcceptFiles,
  handleSendFiles,
  handleAcceptFiles
}) {
  
  const icons = { pending: '📄', active: '🔄', finalizing: '💾', done: '✅', error: '❌' };
  
  return (
    <TransferWrapper>
      <Box id="transferContainer">   
        {/* Fila Envio */}
        <Box id="sendQueueContainer">
          <h3>📦 Fila de Envio / <small>{sendCountText}</small></h3>
          {sendQueue.size === 0 && <p id="emptySendQueue">Nenhum arquivo na fila</p>}
          <ul className="file-queue">
            {Array.from(sendQueue.values()).map(item => (
              <li key={item.id} className={`status-${item.status}`}>
                <span className="file-icon">{icons[item.status]}</span>
                <span className="file-name" title={item.name}>{item.name}</span>
                <span className="file-size">{item.sizeText}</span>
                <div className="file-progress-bar-wrap">
                  <div className="file-progress-bar" style={{ width: `${item.progress}%`, backgroundColor: item.status === 'done' ? '#4CAF50' : '#2196F3' }}></div>
                </div>
              </li>
            ))}
          </ul>
          {showSendConfirm && (
            <Box id="sendContainer" sx={{ display: 'flex !important' }}>
              <p>📦 Confirmar envio de arquivos:</p>
              <p><strong>Tamanho Total:</strong> {totalSendSize}</p>
              <button id="btn-send" onClick={() => handleSendFiles(Date.now())}>Enviar arquivos</button>
            </Box>
          )}
        </Box>

        {/* Fila Recebimento */}
        <Box id="receiveQueueContainer">
          <h3>📥 Fila de Recebimento / <small>{receiveCountText}</small></h3>
          {receiveQueue.size === 0 && <p id="emptyReceiveQueue">Nenhum arquivo na fila</p>}
          <ul className="file-queue">
            {Array.from(receiveQueue.values()).map(item => (
              <li key={item.id} className={`status-${item.status}`}>
                <span className="file-icon">{icons[item.status]}</span>
                <span className="file-name" title={item.name}>{item.name}</span>
                <span className="file-size">{item.sizeText}</span>
                <div className="file-progress-bar-wrap">
                  <div className="file-progress-bar" style={{ width: `${item.progress}%`, backgroundColor: item.status === 'done' ? '#4CAF50' : '#2196F3' }}></div>
                </div>
              </li>
            ))}
          </ul>
          {showAcceptConfirm && (
            <Box id="acceptContainer" sx={{ display: 'flex !important' }}>
              <p>📥 Confirmar o recebimento de arquivos:</p>
              <p><strong>Tamanho Total:</strong> {totalReceiveSize}</p>
              <button id="btn-accept" onClick={handleAcceptFiles} disabled={acceptDisabled}>{acceptBtnText}</button>
            </Box>
          )}
        </Box>
      </Box>
    </TransferWrapper>
  );
}