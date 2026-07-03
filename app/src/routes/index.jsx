import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const Home = lazy(() => import('../pages/Home'));
const VideoPage = lazy(() => import('../pages/VideoPage'));
const TransferPage = lazy(() => import('../pages/TransferPage'));
const ChatPage = lazy(() => import('../pages/ChatPage'));

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/video', element: <VideoPage /> },
  { path: '/transfer', element: <TransferPage /> },
  { path: '/chat', element: <ChatPage /> },
]);