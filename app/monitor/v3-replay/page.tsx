import {redirect} from "next/navigation";
import {cookies} from "next/headers";
import {verifyToken} from "@/lib/auth";
import {roleOf} from "@/lib/monitorRole";
import ReplayPanel from "./panel";
export const dynamic="force-dynamic";
export default async function Page(){const user=verifyToken(cookies().get("mw_session")?.value??"");if(!user||await roleOf(user)!=="super_admin")redirect("/monitor/login");return <ReplayPanel/>;}
