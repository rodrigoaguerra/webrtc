import { createBrowserRouter } from 'react-router-dom';
import Home from '../pages/Home';
import VideoPage from '../pages/VideoPage';
import TransferPage from '../pages/TransferPage';
import ChatPage from '../pages/ChatPage';

export const router = createBrowserRouter([
  { path: '/', element: <Home />, }, // A Home carrega diretamente sem um layout superior obrigatório, respeitando seu HTML originalx
  { path: '/video', element: <VideoPage />, },
  { path: '/transfer', element: <TransferPage />, },
  { path: '/chat', element: <ChatPage />, },
]);