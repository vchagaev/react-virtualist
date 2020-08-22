import React, { useCallback, useRef, useState } from "react";
import { Button, Space, InputNumber, Typography, Divider } from "antd";
import "./App.css";
import "antd/dist/antd.css";

import { getMessages } from "./fake";
import { wait } from "./utils";
import { ChatViewer } from "./ChatViewer/ChatViewer";

const { Text } = Typography;

const API_DELAY = 2 * 1000;
const DEFAULT_BATCH_COUNT = 50;
const DEFAULT_MESSAGE_INDEX = 0;
const MAX_BATCH_COUNT = 100000;

// Mocked client-server interactions

function App() {
  const chatViewerRef = useRef<ChatViewer>(null);
  const [messages, setMessages] = useState(() => {
    return getMessages({ min: DEFAULT_BATCH_COUNT, max: DEFAULT_BATCH_COUNT });
  });
  const [messagesBatchCount, setMessagesBatchCount] = useState<number>(
    DEFAULT_BATCH_COUNT
  );
  const [messageIndex, setMessageIndex] = useState<number>(
    DEFAULT_MESSAGE_INDEX
  );

  const onNewerMessageRequest = useCallback(async () => {
    await wait(API_DELAY);
    setMessages([
      ...messages,
      ...getMessages({ min: DEFAULT_BATCH_COUNT, max: DEFAULT_BATCH_COUNT }),
    ]);
  }, [messages, setMessages]);
  const onOlderMessageRequest = useCallback(async () => {
    await wait(API_DELAY);
    setMessages([
      ...getMessages({ min: DEFAULT_BATCH_COUNT, max: DEFAULT_BATCH_COUNT }),
      ...messages,
    ]);
  }, [messages, setMessages]);

  const chatViewerControlPanel = (
    <Space direction="vertical">
      <Text>Messages batch count</Text>
      <InputNumber
        style={{
          width: "100%",
        }}
        min={1}
        max={MAX_BATCH_COUNT}
        defaultValue={messagesBatchCount}
        onChange={(value) => {
          if (typeof value === "number") {
            setMessagesBatchCount(value);
          }
        }}
      />
      <Button
        block={true}
        onClick={() => {
          const newMessages = [
            ...getMessages({
              min: messagesBatchCount,
              max: messagesBatchCount,
            }),
            ...messages,
          ];
          setMessages(newMessages);
        }}
        type="primary"
      >
        Add older messages
      </Button>
      <Button
        block={true}
        onClick={() => {
          const newMessages = [
            ...messages,
            ...getMessages({
              min: messagesBatchCount,
              max: messagesBatchCount,
            }),
          ];
          setMessages(newMessages);
        }}
        type="primary"
      >
        Add new messages
      </Button>
      <Divider />
      <Text>Message Index</Text>
      <InputNumber
        style={{
          width: "100%",
        }}
        min={0}
        max={messages.length - 1}
        defaultValue={DEFAULT_MESSAGE_INDEX}
        value={messageIndex}
        onChange={(value) => {
          if (typeof value === "number") {
            setMessageIndex(value);
          }
        }}
      />
      <Button
        block={true}
        onClick={() => {
          if (chatViewerRef.current) {
            chatViewerRef.current
              .scrollTo(messages[messageIndex])
              .then(() => {
                console.log("scrolled");
              })
              .catch((error) => {
                console.error(error);
              });
          }
        }}
        type="primary"
      >
        Scroll to message index
      </Button>
      <Button
        block={true}
        onClick={() => {
          if (chatViewerRef.current) {
            chatViewerRef.current
              .scrollTo(messages[Math.floor(Math.random() * messages.length)])
              .then(() => {
                console.log("scrolled");
              })
              .catch((error) => {
                console.error(error);
              });
          }
        }}
        type="primary"
      >
        Scroll to random index
      </Button>
      <Divider />
    </Space>
  );

  return (
    <div className="app">
      <div className="chat-container">
        <div className="chat-settings">{chatViewerControlPanel}</div>
        <div className="chat-messages">
          <ChatViewer
            id="chat-id"
            ref={chatViewerRef}
            messages={messages}
            selectedMessage={messages[Math.floor(messages.length / 2)]}
            hasNewer={true}
            hasOlder={true}
            onNewerMessageRequest={onNewerMessageRequest}
            onOlderMessageRequest={onOlderMessageRequest}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
