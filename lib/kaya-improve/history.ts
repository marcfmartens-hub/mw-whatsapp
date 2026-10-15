import raw from "./history.json";
export type Release={id:string;created_at:string;base_commit:string;files:{path:string;status:string;before:string|null;after:string|null}[]};
export const history=raw as {releases:Release[]};
