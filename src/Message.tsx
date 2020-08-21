import { Avatar, Comment, Collapse, Divider } from "antd";
import moment from "moment";
import React from "react";

const { Panel } = Collapse;

export interface MessageProps {
  id: string;
  fullName: string;
  avatarSrc: string;
  content: string;
  date: Date;
}

export const Message: React.FC<MessageProps> = React.memo(function({
  id,
  fullName,
  avatarSrc,
  content,
  date,
}) {
  return (
    <Comment
      author={
        <a href={`#/${fullName}/${id}`}>
          {fullName}
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
