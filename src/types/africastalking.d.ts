declare module 'africastalking' {
  interface AfricasTalkingSms {
    send(params: { to: string[]; message: string; from?: string }): Promise<{
      SMSMessageData?: {
        Recipients?: Array<{ messageId?: string; status?: string }>;
      };
    }>;
  }

  const AfricasTalking: (opts: { apiKey: string; username: string }) => {
    SMS: AfricasTalkingSms;
  };

  export default AfricasTalking;
}
