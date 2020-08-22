import React, { useCallback, useEffect, useRef, useState } from "react";
import faker from "faker";
import { Button, Space, InputNumber, Typography, Divider } from "antd";
import "./App.css";
import "antd/dist/antd.css";

import { getRandomMessageContent } from "./fake";
import { getRandomInt, wait } from "./utils";
import { ChatViewer } from "./ChatViewer";

const { Text } = Typography;

const DEFAULT_BATCH_COUNT = 50;
const DEFAULT_MESSAGE_INDEX = 0;

interface GetMessagesParams {
  min: number;
  max: number;
}

const getMessages = ({ min, max }: GetMessagesParams) => {
  const count = getRandomInt(min, max);

  return new Array(count).fill(null).map(() => ({
    id: faker.random.uuid(),
    fullName: faker.name.findName(),
    avatarSrc: faker.internet.avatar(),
    content: getRandomMessageContent(),
    date: faker.date.past(),
  }));
};

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

  const [hasNewer, setHasNewer] = useState<boolean>(true);
  const [hasOlder, setHasOlder] = useState<boolean>(true);

  const onNewerMessageRequest = useCallback(async (item) => {
    console.log("give me newer", item);
    await wait(3 * 1000);
    setMessages([...messages, ...getMessages({ min: 25, max: 25 })]);
  }, [messages, setMessages]);
  const onOlderMessageRequest = useCallback(
    async (item) => {
      await wait(3 * 1000);
      setMessages([...getMessages({ min: 25, max: 25 }), ...messages]);
    },
    [messages, setMessages]
  );

  // useEffect(() => {
  //   const intervalId = setInterval(() => {
  //     setMessages([...messages, ...getMessages({ min: 0, max: 2 })]);
  //   }, 5 * 1000);
  //
  //   return () => {
  //     clearInterval(intervalId);
  //   };
  // }, [messages, setMessages, chatViewerRef.current]);

  // useEffect(() => {
  //   if (chatViewerRef.current && chatViewerRef.current.isAtTheBottom) {
  //     chatViewerRef.current.scrollTo({ index: messages.length - 1 });
  //   }
  // }, [chatViewerRef.current, messages]);

  return (
    <div className="app">
      <div className="chat-container">
        <div className="chat-settings">
          <Space direction="vertical">
            <Text>Messages batch count</Text>
            <InputNumber
              style={{
                width: "100%",
              }}
              min={1}
              max={1000000}
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
                    .scrollTo(messageIndex)
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
                    .scrollTo(Math.round(Math.random() * messages.length))
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
        </div>
        <div className="chat-messages">
          <ChatViewer
            id="chat-id"
            ref={chatViewerRef}
            messages={messages}
            hasNewer={hasNewer}
            hasOlder={hasOlder}
            onNewerMessageRequest={onNewerMessageRequest}
            onOlderMessageRequest={onOlderMessageRequest}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
