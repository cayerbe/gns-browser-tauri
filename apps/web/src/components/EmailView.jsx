import React, { useState } from 'react';
import {
    EmailList,
    EmailThreadView as EmailThread,
    EmailSidebar,
    EmailCompose
} from '@gns/ui';
import { useApi } from '@gns/ui';

export function EmailView() {
    const [currentFolder, setCurrentFolder] = useState('inbox');
    const [selectedThread, setSelectedThread] = useState(null);
    const [isComposing, setIsComposing] = useState(false);
    const { api } = useApi();

    return (
        <div className="flex h-full bg-background overflow-hidden">
            <EmailSidebar
                currentFolder={currentFolder}
                onSelectFolder={(folder) => {
                    setCurrentFolder(folder);
                    setSelectedThread(null);
                }}
                unreadCount={0}
            />

            {!selectedThread ? (
                <div className="flex-1 min-w-0">
                    <EmailList
                        folder={currentFolder}
                        onSelectThread={setSelectedThread}
                        onCompose={() => setIsComposing(true)}
                    />
                </div>
            ) : (
                <div className="flex-1 min-w-0">
                    <EmailThread
                        thread={selectedThread}
                        onBack={() => setSelectedThread(null)}
                        onReply={(msg) => console.log('Reply', msg)}
                        onForward={(msg) => console.log('Forward', msg)}
                        onDelete={() => console.log('Delete')}
                    />
                </div>
            )}

            {isComposing && (
                <EmailCompose
                    onClose={() => setIsComposing(false)}
                    initialData={{}}
                />
            )}
        </div>
    );
}
