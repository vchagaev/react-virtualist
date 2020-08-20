import { Avatar, Comment, Collapse, Divider } from "antd";
import moment from "moment";
import React from "react";

const { Panel } = Collapse;

export interface MessageProps {
  index: number;
  id: string;
  fullName: string;
  avatarSrc: string;
  content: string;
  date: Date;
  offset: string;
  height: string;
}

export const Message: React.FC<MessageProps> = React.memo(function({
  fullName,
  avatarSrc,
  content,
  date,
  index,
  offset,
  height
}) {
  return (
    <Comment
      author={
        <a href={`#/${fullName}`}>
          {index} {fullName} (Offset: {offset}) (Height: {height})
        </a>
      }
      avatar={<Avatar src={avatarSrc} alt={fullName} />}
      content={
        <>
          <p>{content}</p>
          <Divider orientation="left">Actions to change height</Divider>
          <Collapse accordion>
            <Panel header="This is panel header 1" key="1">
              <p>Text</p>
            </Panel>
            <Panel header="This is panel header 2" key="2">
              <p>Text2</p>
            </Panel>
          </Collapse>
        </>
      }
      datetime={<span>{moment(date).calendar()}</span>}
    />
  );
});
